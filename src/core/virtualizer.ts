import {assert} from '../asserts.ts';
import {
  findRow,
  firstRow,
  queryRows,
  rectInViewport,
  VROW_INDEX_ATTR,
  VROW_KEY_ATTR,
} from './dom.ts';
import type {RowsQueryInputs, RowsSnapshot} from './rows.ts';
import type {ScrollAdapter, ScrollRect} from './scroll-adapter.ts';
import type {
  Anchor,
  AnchoringMode,
  RowKey,
  ScrollHistoryState,
  VirtualRow,
} from './types.ts';

// Make sure this is even since we half it for scroll state loading
const MIN_PAGE_SIZE = 100;

const NUM_ROWS_FOR_LOADING_SKELETON = 1;

// Debounce for persisting scroll state via onScrollStateChange.
const PERSIST_DEBOUNCE_MS = 100;

const defaultKeyExtractor = (index: number): RowKey => index;

// Use manual anchoring wherever the browser doesn't implement CSS scroll
// anchoring - notably older versions of Safari. Feature detection, not UA
// sniffing; overridable via the `anchoring` option.
function detectNeedsManualAnchoring(): boolean {
  return typeof CSS === 'undefined' || !CSS.supports('overflow-anchor', 'auto');
}

const TOP_ANCHOR = Object.freeze({
  index: 0,
  kind: 'forward',
  startRow: undefined,
}) satisfies Anchor<unknown>;

const createPermalinkAnchor = (id: string) =>
  ({
    id,
    index: NUM_ROWS_FOR_LOADING_SKELETON,
    kind: 'permalink',
  }) as const;

/**
 * Pairs the paging anchor with the list-context params (sort/filter) it was
 * created under, so the two can only change together. While they disagree with
 * the current options (`!isListContextCurrent` — e.g. right after a sort change
 * or browser back/forward), paging and count updates stand down: we never
 * query with an anchor from one context against the params of another.
 */
type QueryAnchor<TListContextParams, TStartRow> = {
  readonly anchor: Anchor<TStartRow>;
  readonly listContextParams: TListContextParams;
};

/**
 * The virtualizer's pagination state. Kept in a single object so multi-field
 * updates — e.g. relabeling the anchor index together with the estimated total
 * — stay atomic.
 */
type PagingState<TListContextParams, TStartRow> = {
  estimatedTotal: number;
  hasReachedStart: boolean;
  hasReachedEnd: boolean;
  queryAnchor: QueryAnchor<TListContextParams, TStartRow>;
};

function restoredPagingState<TListContextParams, TStartRow>(
  state: ScrollHistoryState<TStartRow>,
  listContextParams: TListContextParams,
): PagingState<TListContextParams, TStartRow> {
  return {
    estimatedTotal: state.estimatedTotal,
    hasReachedStart: state.hasReachedStart,
    hasReachedEnd: state.hasReachedEnd,
    queryAnchor: {anchor: state.anchor, listContextParams},
  };
}

function permalinkPagingState<TListContextParams, TStartRow>(
  id: string,
  listContextParams: TListContextParams,
): PagingState<TListContextParams, TStartRow> {
  return {
    estimatedTotal: NUM_ROWS_FOR_LOADING_SKELETON,
    hasReachedStart: false,
    hasReachedEnd: false,
    queryAnchor: {anchor: createPermalinkAnchor(id), listContextParams},
  };
}

/**
 * Framework-free options of {@linkcode ZeroVirtualizer}. The framework
 * wrappers add their own fields on top (`getScrollElement`, the query
 * functions, `scrollAdapter`) — those never reach the core: elements arrive
 * via {@linkcode ZeroVirtualizer.attach} and query results via
 * {@linkcode ZeroVirtualizer.setRows}.
 */
export type VirtualizerOptions<TListContextParams, TRow, TStartRow> = {
  estimateSize: (index: number) => number;
  overscan?: number | undefined;
  anchoring?: AnchoringMode | undefined;
  getRowKey: (row: TRow) => RowKey;
  listContextParams: TListContextParams;
  count?: number | undefined;
  permalinkID?: string | null | undefined;
  settleTime?: number | undefined;
  scrollState?: ScrollHistoryState<TStartRow> | null | undefined;
  onScrollStateChange?:
    | ((state: ScrollHistoryState<TStartRow>) => void)
    | undefined;
  onSettled?: (() => void) | undefined;
};

/** What {@linkcode ZeroVirtualizer.getSnapshot} returns — see the react hook's
 * result docs for field semantics. Cached: identity changes only when content
 * actually changed. */
export type VirtualizerSnapshot<TRow> = {
  items: ReadonlyArray<VirtualRow<TRow>>;
  spaceBefore: number;
  spaceAfter: number;
  rowAt: (index: number) => TRow | undefined;
  complete: boolean;
  rowsEmpty: boolean;
  permalinkNotFound: boolean;
  estimatedTotal: number;
  total: number | undefined;
  settled: boolean;
  debug: {
    readonly current: {
      readonly isScrolling: boolean;
      readonly pendingJump: number;
    };
  };
};

const EMPTY_ROWS: RowsSnapshot<unknown> = {
  rowAt: () => undefined,
  rowsLength: 0,
  complete: false,
  rowsEmpty: true,
  atStart: false,
  atEnd: false,
  firstRowIndex: 0,
  permalinkNotFound: false,
};

/**
 * The framework-agnostic virtualizer: bidirectional paging over Zero queries
 * with scroll anchoring (native `overflow-anchor` where supported, a
 * momentum-safe manual equivalent elsewhere).
 *
 * Lifecycle contract with framework wrappers (TanStack-Virtual-style):
 * - Construct once per component lifetime (the constructor is pure — no DOM,
 *   listeners, or timers — so speculative construction is safe).
 * - `setOptions()` on every render/reactive update and `setRows()` whenever
 *   query results change. Both are silent data ingestion: they never notify
 *   and never touch the DOM (they may be called mid-render).
 * - `attach()` + `afterDOMUpdate()` after the framework committed row DOM,
 *   before paint (React: layout effect; Solid: effect). All state transitions
 *   and DOM work flush here or from scroll/touch/timer events.
 * - Rendering state comes from `getSnapshot()` (cached identity); re-render
 *   signals from `subscribe()`.
 *
 * @experimental The core API is public but unstable; the `./react` and
 * `./solid` entry points are the stable surfaces.
 */
export class ZeroVirtualizer<TListContextParams, TRow, TStartRow> {
  readonly #adapter: ScrollAdapter;
  #options: VirtualizerOptions<TListContextParams, TRow, TStartRow>;
  #rows: RowsSnapshot<TRow> = EMPTY_ROWS as RowsSnapshot<TRow>;

  // ---- paging state ---------------------------------------------------------
  #paging: PagingState<TListContextParams, TStartRow>;
  #pageSize = MIN_PAGE_SIZE;
  #settled = false;

  // ---- change propagation ---------------------------------------------------
  readonly #listeners = new Set<() => void>();
  // Bumped by every mutation that can affect the snapshot or query inputs.
  #version = 0;
  // Version at the last snapshot build (cache key).
  #snapshotVersion = -1;
  #snapshot: VirtualizerSnapshot<TRow> | null = null;
  #itemsCache: {
    key: readonly [
      (index: number) => TRow | undefined,
      number,
      number,
      (row: TRow) => RowKey,
    ];
    items: VirtualRow<TRow>[];
  } | null = null;

  // ---- scroll / anchoring machine (all imperative) --------------------------
  #el: HTMLElement | null = null;
  #unsubscribe: (() => void) | null = null;
  #prevOverflowAnchor = '';
  #detachTouch: (() => void) | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #observedItems: ReadonlyArray<VirtualRow<TRow>> | null = null;
  #programmaticScroll = false;
  #anchorKey: RowKey | null = null;
  // The reference row's top offset from the viewport top, in the settled
  // (hold-free) frame — what the anchoring keeps stable across relabels and
  // off-screen resizes (matching native `overflow-anchor`).
  #anchorOffset = 0;
  // True from a list reset (context change / restore / permalink) until the new
  // data has loaded, so we don't adopt or pin a stale reference row.
  #anchorSuppressed = false;
  // Whether the in-flight scroll was initiated by touch. Only then do we take
  // the momentum-safe margin-hold path — wheel / trackpad / programmatic
  // scrolls can safely write scrollTop.
  #touchScroll = false;
  #fingerDown = false;
  // Whether any (non-programmatic) scrolling happened during the current touch
  // gesture: a plain tap must end the gesture at touchend itself, because no
  // scrolling means no `scrollend` will ever fire for it.
  #gestureScrolled = false;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  #persistTimer: ReturnType<typeof setTimeout> | undefined;
  // The live anchoring state; also exposed (read-only) as `debug`.
  readonly #anchorState = {isScrolling: false, pendingJump: 0};
  // The row element currently carrying the held margin.
  #holdEl: HTMLElement | null = null;

  // Set to a permalink id when navigation targets a row that is NOT currently
  // visible, meaning we should scroll it to the top once it loads. Stays null
  // when a permalink points at an already-visible row (clicking a row never
  // scrolls it).
  #pendingPermalinkScroll: RowKey | null;

  // Restore/reset change tracking (the old effect's dependency semantics).
  #appliedScrollState: ScrollHistoryState<TStartRow> | null = null;
  #appliedPermalinkID: string | null | undefined;
  // effectiveScrollState cache, keyed by the identities of its two inputs.
  #effScrollStateKey: readonly [unknown, unknown] | null = null;
  #effScrollState: ScrollHistoryState<TStartRow> | null = null;
  // Persist-scheduling change detection.
  #lastPersistKey = '';
  // Settle-timer reset on list-context change (the old effect's dep).
  #lastSettleContext: TListContextParams;

  constructor(
    options: VirtualizerOptions<TListContextParams, TRow, TStartRow>,
    adapter: ScrollAdapter,
  ) {
    this.#adapter = adapter;
    this.#options = options;
    // Initialize paging directly from the restorable state so the first
    // render already queries the right window (this also survives React
    // Strict Mode's double construction — the constructor is pure).
    const eff = this.#effectiveScrollState();
    const {permalinkID, listContextParams} = options;
    this.#paging = eff
      ? restoredPagingState(eff, listContextParams)
      : permalinkID
        ? permalinkPagingState(permalinkID, listContextParams)
        : {
            estimatedTotal: NUM_ROWS_FOR_LOADING_SKELETON,
            hasReachedStart: false,
            hasReachedEnd: false,
            queryAnchor: {anchor: TOP_ANCHOR, listContextParams},
          };
    this.#pendingPermalinkScroll = permalinkID && !eff ? permalinkID : null;
    this.#appliedPermalinkID = permalinkID;
    this.#lastSettleContext = listContextParams;
  }

  // ---- wrapper-facing surface ------------------------------------------------

  /** Silent options ingestion — safe to call during render. */
  setOptions(
    options: VirtualizerOptions<TListContextParams, TRow, TStartRow>,
  ): void {
    this.#options = options;
  }

  /** Silent rows ingestion — safe to call during render. */
  setRows(rows: RowsSnapshot<TRow>): void {
    if (rows !== this.#rows) {
      this.#rows = rows;
      this.#version++;
    }
  }

  /**
   * The inputs the framework wrapper must feed into its Zero query binding
   * (results come back via {@linkcode setRows}).
   */
  getQueryInputs(): RowsQueryInputs<TStartRow> {
    return {
      pageSize: this.#pageSize,
      anchor: this.#effectiveAnchor(),
      settled: this.#settled,
    };
  }

  /** Re-render signal for wrappers; returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The current render state. Cached — identity changes only with content. */
  getSnapshot(): VirtualizerSnapshot<TRow> {
    if (this.#snapshot !== null && this.#snapshotVersion === this.#version) {
      return this.#snapshot;
    }
    this.#snapshot = this.#buildSnapshot();
    this.#snapshotVersion = this.#version;
    return this.#snapshot;
  }

  /**
   * Wire (or re-wire, if the element changed) the scroll container. Idempotent
   * per element; call every commit alongside {@linkcode afterDOMUpdate}.
   */
  attach(el: HTMLElement | null): void {
    if (el === this.#el) return;
    this.#detachEl();
    this.#el = el;
    if (!el) return;

    // Toggle native scroll anchoring to match the resolved mode: off (so it
    // can't fight our compensation) in manual mode, on in native mode. Set on
    // the scroll element; spacers keep their own `overflow-anchor: none` so
    // native mode still anchors to a real row, not a resizing spacer.
    const scroller = this.#adapter.scrollElement(el);
    this.#prevOverflowAnchor = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = this.#manual() ? 'none' : 'auto';

    this.#unsubscribe = this.#adapter.subscribe(
      el,
      this.#onScroll,
      this.#onScrollEnd,
    );
    // Touch events bubble, so the scroll element hears every touch inside it.
    // The touch/scrollend machinery only drives manual mode.
    if (this.#manual()) {
      const t = scroller;
      t.addEventListener('touchstart', this.#onTouchStart, {passive: true});
      t.addEventListener('touchend', this.#onTouchEnd, {passive: true});
      t.addEventListener('touchcancel', this.#onTouchEnd, {passive: true});
      this.#detachTouch = () => {
        t.removeEventListener('touchstart', this.#onTouchStart);
        t.removeEventListener('touchend', this.#onTouchEnd);
        t.removeEventListener('touchcancel', this.#onTouchEnd);
      };
    }
    this.#resetSettleTimer();
  }

  /** Remove all listeners/observers/timers. State survives (Strict Mode). */
  detach(): void {
    this.#detachEl();
  }

  #detachEl(): void {
    const el = this.#el;
    if (!el) return;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#detachTouch?.();
    this.#detachTouch = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#observedItems = null;
    clearTimeout(this.#settleTimer);
    clearTimeout(this.#persistTimer);
    this.#adapter.scrollElement(el).style.overflowAnchor =
      this.#prevOverflowAnchor;
    this.#el = null;
  }

  /**
   * Run after the framework committed row DOM, before paint. Hosts every
   * rows/options-driven state transition and all layout-reading DOM work (the
   * old React effect chain, in commit order). Notifies at the end if anything
   * observable changed.
   */
  afterDOMUpdate(): void {
    this.#withNotify(() => this.#afterDOMUpdate());
  }

  #afterDOMUpdate(): void {
    // The settle clock restarts when the list context changes (new sort /
    // filter = a fresh, un-settled list).
    if (this.#options.listContextParams !== this.#lastSettleContext) {
      this.#lastSettleContext = this.#options.listContextParams;
      this.#resetSettleTimer();
    }

    // -- layout-effect phase (order preserved from the React hook) --
    this.#measureAndCompensate();
    this.#reobserveRows();
    this.#restoreOrReset();
    this.#retryPendingPermalinkScroll();

    // -- passive-effect phase --
    this.#liftAnchorSuppression();
    this.#updatePageSize();
    this.#applyReachedLatches();
    this.#bumpEstimatedTotal();
    this.#relabelAnchor();
    this.#evaluatePaging();
    this.#schedulePersistIfChanged();
  }

  // ---- derived values --------------------------------------------------------

  #manual(): boolean {
    const anchoring = this.#options.anchoring ?? 'auto';
    return (
      anchoring === 'manual' ||
      (anchoring === 'auto' && detectNeedsManualAnchoring())
    );
  }

  // Only restore from scrollState if its listContextParams matches the current
  // context. JSON compare (state may come from serialized storage where object
  // identity is not preserved), cached by input identities so it isn't
  // re-stringified per call.
  #effectiveScrollState(): ScrollHistoryState<TStartRow> | null {
    const {scrollState, listContextParams} = this.#options;
    const key = [scrollState, listContextParams] as const;
    if (
      this.#effScrollStateKey &&
      this.#effScrollStateKey[0] === key[0] &&
      this.#effScrollStateKey[1] === key[1]
    ) {
      return this.#effScrollState;
    }
    let eff: ScrollHistoryState<TStartRow> | null = null;
    if (scrollState) {
      eff =
        JSON.stringify(scrollState.listContextParams) ===
        JSON.stringify(listContextParams)
          ? scrollState
          : null;
    }
    this.#effScrollStateKey = key;
    this.#effScrollState = eff;
    return eff;
  }

  #isListContextCurrent(): boolean {
    return (
      this.#paging.queryAnchor.listContextParams ===
      this.#options.listContextParams
    );
  }

  // The anchor the queries should use *right now*: the paging anchor while it
  // belongs to the current context; otherwise (first render after a context
  // change) fall back so the very first query already targets the new context.
  #effectiveAnchor(): Anchor<TStartRow> {
    if (this.#isListContextCurrent()) {
      return this.#paging.queryAnchor.anchor;
    }
    const {permalinkID} = this.#options;
    return permalinkID
      ? createPermalinkAnchor(permalinkID)
      : (TOP_ANCHOR as Anchor<TStartRow>);
  }

  #rowEstimate(): number {
    return Math.max(1, this.#options.estimateSize(0));
  }

  #effectiveEstimatedTotal(): number {
    const {count} = this.#options;
    const rows = this.#rows;
    const newEstimatedTotal = rows.firstRowIndex + rows.rowsLength;
    return (
      count ??
      (rows.atEnd && rows.atStart && rows.complete
        ? rows.rowsLength
        : Math.max(this.#paging.estimatedTotal, newEstimatedTotal))
    );
  }

  #buildSnapshot(): VirtualizerSnapshot<TRow> {
    const rows = this.#rows;
    const {count, getRowKey} = this.#options;
    const {estimatedTotal, hasReachedStart, hasReachedEnd} = this.#paging;
    const effectiveEstimatedTotal = this.#effectiveEstimatedTotal();

    // Spacer heights: the estimated pixel extent of the unloaded rows above
    // and below the loaded window (the scrollbar is approximate, exactly as
    // with any virtualized list).
    const rowEstimate = this.#rowEstimate();
    const rowsBefore = Math.max(0, rows.firstRowIndex);
    const rowsAfter = rows.atEnd
      ? 0
      : Math.max(
          0,
          effectiveEstimatedTotal - (rows.firstRowIndex + rows.rowsLength),
        );

    // The rows to render, keyed by row id when loaded so their DOM nodes
    // persist across paging — that identity is what scroll anchoring measures
    // against. Cached so items identity is stable when the window is.
    const itemsKey = [
      rows.rowAt,
      rows.firstRowIndex,
      rows.rowsLength,
      getRowKey,
    ] as const;
    let items: VirtualRow<TRow>[];
    const cached = this.#itemsCache;
    if (
      cached &&
      cached.key[0] === itemsKey[0] &&
      cached.key[1] === itemsKey[1] &&
      cached.key[2] === itemsKey[2] &&
      cached.key[3] === itemsKey[3]
    ) {
      items = cached.items;
    } else {
      items = [];
      for (
        let i = rows.firstRowIndex;
        i < rows.firstRowIndex + rows.rowsLength;
        i++
      ) {
        const row = rows.rowAt(i);
        items.push({
          index: i,
          key: row ? getRowKey(row) : defaultKeyExtractor(i),
          row,
        });
      }
      this.#itemsCache = {key: itemsKey, items};
    }

    const total =
      count ??
      (rows.atStart && rows.atEnd
        ? rows.rowsLength
        : hasReachedStart && hasReachedEnd
          ? estimatedTotal
          : undefined);

    return {
      items,
      spaceBefore: rows.atStart ? 0 : rowsBefore * rowEstimate,
      spaceAfter: rowsAfter * rowEstimate,
      rowAt: rows.rowAt,
      complete: rows.complete,
      rowsEmpty: count === undefined ? rows.rowsEmpty : count === 0,
      permalinkNotFound: rows.permalinkNotFound,
      estimatedTotal: effectiveEstimatedTotal,
      total,
      settled: this.#settled,
      debug: {current: this.#anchorState},
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  // Run a state-mutating block outside render, notifying listeners once at
  // the end if anything observable changed.
  #withNotify(fn: () => void): void {
    const before = this.#version;
    fn();
    if (this.#version !== before) {
      this.#notify();
    }
  }

  #setPaging(next: PagingState<TListContextParams, TStartRow>): void {
    if (next !== this.#paging) {
      this.#paging = next;
      this.#version++;
    }
  }

  // Replace the paging anchor. `totalDelta` grows the estimated total in the
  // same (atomic) update when the anchor change relabels the virtual
  // coordinate space; the manual anchoring re-pins the reference row across
  // the relabel, so the visible content stays put.
  #setAnchor(anchor: Anchor<TStartRow>, totalDelta = 0): void {
    const s = this.#paging;
    this.#setPaging({
      ...s,
      estimatedTotal: s.estimatedTotal + totalDelta,
      queryAnchor: {...s.queryAnchor, anchor},
    });
  }

  // ---- scroll geometry -------------------------------------------------------

  #scrollOffset(el: HTMLElement): number {
    return this.#adapter.scrollElement(el).scrollTop;
  }

  #viewportRect(el: HTMLElement): ScrollRect {
    const se = this.#adapter.scrollElement(el);
    return {width: se.clientWidth, height: se.clientHeight};
  }

  // Scroll to an absolute offset, skipping no-op writes (same rounded offset).
  // Returns whether it actually wrote — i.e. whether the position moved.
  #setScrollTop(top: number): boolean {
    const el = this.#el;
    if (el && Math.round(this.#scrollOffset(el)) !== Math.round(top)) {
      this.#programmaticScroll = true;
      this.#adapter.scrollElement(el).scrollTop = top;
      return true;
    }
    return false;
  }

  // ---- manual, momentum-safe scroll anchoring --------------------------------
  // Native overflow-anchor is disabled in manual mode, so we keep the viewport
  // visually stable ourselves: pin one keyed "reference" row; whenever the
  // loaded rows change size above it, measure how far it moved and put it back.
  // Idle we fold the correction into scrollTop; during a touch gesture we hold
  // it as a margin-top on the first rendered row — writing scrollTop
  // mid-momentum is ignored / cancels the fling on iOS, while a layout shift
  // is fine — and reconcile margin→scrollTop when the gesture ends.

  // Apply the held correction as a margin-top on the first rendered row (px is
  // -pendingJump: negative pulls the content up).
  #applyHold(px: number): void {
    const el = this.#el;
    const first = el ? firstRow(el) : null;
    const prev = this.#holdEl;
    if (prev && prev !== first) prev.style.marginTop = '';
    this.#holdEl = px !== 0 ? first : null;
    if (first) first.style.marginTop = px !== 0 ? `${px}px` : '';
  }

  // If paging replaced the first row while a hold is applied, move the margin
  // to the new first row (pre-paint, so nothing shifts visibly).
  #migrateHold(): void {
    if (this.#holdEl === null) return;
    const el = this.#el;
    const first = el ? firstRow(el) : null;
    if (first !== this.#holdEl) {
      this.#applyHold(-this.#anchorState.pendingJump);
    }
  }

  // A row rect's top offset from the viewport top, the held margin folded out.
  #anchorOffsetOf(el: HTMLElement, rect: DOMRect): number {
    return (
      rect.top - this.#adapter.viewportTop(el) + this.#anchorState.pendingJump
    );
  }

  #refreshAnchor(): void {
    const el = this.#el;
    if (!el) return;
    const vTop = this.#adapter.viewportTop(el);
    // Top-most visible row (first whose bottom is below the viewport top), the
    // same reference the browser's native scroll anchoring would pick.
    let ref: HTMLElement | null = null;
    for (const child of queryRows(el)) {
      if (child.getBoundingClientRect().bottom > vTop + 0.5) {
        ref = child;
        break;
      }
    }
    this.#anchorKey = ref?.getAttribute(VROW_KEY_ATTR) ?? null;
    this.#anchorOffset = ref
      ? this.#anchorOffsetOf(el, ref.getBoundingClientRect())
      : 0;
  }

  // The single correction choke point: idle → scrollTop; mid-gesture → hold as
  // the first-row margin, owed to the reconcile at gesture end.
  #compensate(delta: number): void {
    const el = this.#el;
    if (!el) return;
    if (this.#anchorState.isScrolling && this.#touchScroll) {
      this.#anchorState.pendingJump += delta;
      // Unlike the scrollTop path (which moves the settled layout back to the
      // target), the hold leaves the reference's settled position shifted by
      // `delta`. Re-baseline the target so we don't keep re-compensating the
      // same growth; the owed jump is flushed at reconcile.
      this.#anchorOffset += delta;
      this.#applyHold(-this.#anchorState.pendingJump);
    } else {
      this.#setScrollTop(this.#scrollOffset(el) + delta);
    }
  }

  #measureAndCompensate(): void {
    // Stand down while another mechanism owns the scroll position: a permalink
    // jump scrolling its target to the top, or a list-context change resetting
    // the list.
    if (
      !this.#manual() ||
      this.#anchorSuppressed ||
      !this.#isListContextCurrent() ||
      this.#pendingPermalinkScroll !== null
    ) {
      return;
    }
    const el = this.#el;
    if (!el) return;
    // If paging swapped out the row carrying the held margin, re-pin it before
    // measuring so the hold isn't double-counted as movement.
    this.#migrateHold();
    // Match native scroll anchoring, which the spec suppresses at scroll
    // offset 0: a prepend there should be *revealed* (push content down), not
    // compensated away. Re-base to the new top row instead of pinning the old
    // one. (`<= 0` also covers iOS rubber-band overscroll.)
    if (this.#scrollOffset(el) <= 0) {
      this.#refreshAnchor();
      return;
    }
    const key = this.#anchorKey;
    const ref = key !== null ? findRow(el, key) : null;
    if (!ref) {
      // No valid reference yet, or it scrolled out of the loaded window —
      // adopt the current topmost visible row.
      this.#refreshAnchor();
      return;
    }
    const delta =
      this.#anchorOffsetOf(el, ref.getBoundingClientRect()) -
      this.#anchorOffset;
    if (Math.abs(delta) < 0.5) return;
    this.#compensate(delta);
  }

  // Fold any owed jump into scrollTop while the margin still holds the pixels,
  // then clear the held margin (one paint, no visible jump).
  #flushHold(): boolean {
    const el = this.#el;
    if (el && this.#anchorState.pendingJump !== 0) {
      this.#setScrollTop(
        this.#scrollOffset(el) + this.#anchorState.pendingJump,
      );
      this.#anchorState.pendingJump = 0;
      this.#applyHold(0);
      return true;
    }
    return false;
  }

  // End of a scroll gesture: reconcile the held margin, re-base the anchor,
  // and re-evaluate paging at the settled position.
  #endScrolling(): void {
    if (!this.#anchorState.isScrolling) return;
    this.#anchorState.isScrolling = false;
    this.#touchScroll = false;
    this.#fingerDown = false;
    this.#flushHold();
    this.#refreshAnchor();
    this.#evaluate();
  }

  // Lift anchoring suppression once the reset list has loaded, and adopt a
  // fresh reference from the settled list.
  #liftAnchorSuppression(): void {
    if (
      this.#anchorSuppressed &&
      this.#isListContextCurrent() &&
      this.#rows.complete
    ) {
      this.#anchorSuppressed = false;
      this.#refreshAnchor();
    }
  }

  // ---- event handlers --------------------------------------------------------
  // Gesture end is driven by the native `scrollend` event (guaranteed by the
  // supported browsers — see the Safari 26 requirement in the README), plus
  // touch state: a gesture never ends while a finger is down, and a tap that
  // never scrolled ends at touchend (no scrolling → no scrollend).

  #onScroll = (): void => {
    const programmatic = this.#programmaticScroll;
    this.#programmaticScroll = false;
    // Manual anchoring only: a user / momentum scroll (not our own
    // compensation / reconcile / restore / permalink write) marks us as
    // scrolling — via scroll events, not only touchstart, so it also fires for
    // trackpad / wheel scrolling that emits no touch events — and re-bases the
    // anchor.
    if (this.#manual() && !programmatic) {
      this.#anchorState.isScrolling = true;
      this.#gestureScrolled = true;
      this.#refreshAnchor();
    }
    this.#resetSettleTimer();
    this.#withNotify(() => this.#evaluate());
  };

  #onScrollEnd = (): void => {
    if (!this.#manual()) return;
    if (!this.#fingerDown) {
      this.#withNotify(() => this.#endScrolling());
    }
  };

  #onTouchStart = (): void => {
    this.#fingerDown = true;
    this.#touchScroll = true;
    // Arm the hold path immediately so a correction landing between
    // touchstart and the first scroll event never writes scrollTop under an
    // active finger.
    this.#anchorState.isScrolling = true;
    this.#gestureScrolled = false;
  };

  #onTouchEnd = (): void => {
    this.#fingerDown = false;
    if (!this.#gestureScrolled) {
      // A tap: nothing scrolled, so no scrollend is coming — end now.
      this.#withNotify(() => this.#endScrolling());
    }
    // Otherwise momentum (or the just-finished drag) concludes with the
    // browser's scrollend, which reconciles via #onScrollEnd.
  };

  // Scroll-driven evaluation (replaces the old scrollTick re-render): paging,
  // page size, and persist scheduling react to fresh DOM geometry directly.
  #evaluate(): void {
    this.#updatePageSize();
    this.#evaluatePaging();
    this.#schedulePersist();
  }

  // ---- settle ----------------------------------------------------------------

  #resetSettleTimer(): void {
    if (this.#settled) {
      this.#settled = false;
      this.#version++;
    }
    clearTimeout(this.#settleTimer);
    this.#settleTimer = setTimeout(() => {
      this.#settled = true;
      this.#version++;
      this.#options.onSettled?.();
      this.#notify();
    }, this.#options.settleTime ?? 2000);
  }

  // ---- rows/options-driven transitions (afterDOMUpdate) -----------------------

  #updatePageSize(): void {
    const el = this.#el;
    const height = el ? this.#viewportRect(el).height : 0;
    const newPageSize =
      height > 0
        ? Math.max(
            MIN_PAGE_SIZE,
            makeEven(Math.ceil(height / this.#rowEstimate()) * 3),
          )
        : MIN_PAGE_SIZE;
    if (newPageSize > this.#pageSize) {
      this.#pageSize = newPageSize;
      this.#version++;
    }
  }

  #applyReachedLatches(): void {
    const s = this.#paging;
    const hasReachedStart = s.hasReachedStart || this.#rows.atStart;
    const hasReachedEnd = s.hasReachedEnd || this.#rows.atEnd;
    if (
      hasReachedStart !== s.hasReachedStart ||
      hasReachedEnd !== s.hasReachedEnd
    ) {
      this.#setPaging({...s, hasReachedStart, hasReachedEnd});
    }
  }

  // The estimated total is a monotonic high-water mark of the discovered
  // extent: propose the current extent (exact when both ends are loaded) and
  // keep the max.
  #bumpEstimatedTotal(): void {
    const rows = this.#rows;
    if (!rows.complete) return;
    const proposed =
      rows.atStart && rows.atEnd
        ? rows.rowsLength
        : rows.firstRowIndex + rows.rowsLength;
    if (proposed > this.#paging.estimatedTotal) {
      this.#setPaging({...this.#paging, estimatedTotal: proposed});
    }
  }

  // Keep the anchor index non-negative and collapse phantom space at the top.
  // Both branches relabel the virtual coordinate space, so the estimated total
  // moves by the same offset (atomically, via #setAnchor).
  #relabelAnchor(): void {
    const rows = this.#rows;
    if (rows.rowsEmpty || !this.#isListContextCurrent()) {
      return;
    }
    const anchor = this.#paging.queryAnchor.anchor;
    if (rows.firstRowIndex < 0) {
      const placeholderRows = !rows.atStart ? NUM_ROWS_FOR_LOADING_SKELETON : 0;
      const offset = -rows.firstRowIndex + placeholderRows;
      this.#setAnchor({...anchor, index: anchor.index + offset}, offset);
      return;
    }
    if (rows.atStart && rows.firstRowIndex > 0) {
      this.#setAnchor(TOP_ANCHOR as Anchor<TStartRow>, -rows.firstRowIndex);
    }
  }

  // The restore / context-reset / permalink-navigation block. Runs only when
  // its inputs changed (the old effect's dependency semantics): a new
  // persisted state, a new permalinkID, or a context mismatch.
  #restoreOrReset(): void {
    const eff = this.#effectiveScrollState();
    const {permalinkID, listContextParams} = this.#options;
    const scrollStateChanged = eff !== this.#appliedScrollState;
    const permalinkChanged = permalinkID !== this.#appliedPermalinkID;
    this.#appliedScrollState = eff;
    this.#appliedPermalinkID = permalinkID;

    if (
      this.#isListContextCurrent() &&
      !scrollStateChanged &&
      !permalinkChanged
    ) {
      return;
    }

    // A list-context (sort/filter) change resets the list: drop the anchor and
    // suppress it until the new data loads, so we don't adopt or pin a stale
    // reference row from the outgoing list.
    if (!this.#isListContextCurrent()) {
      this.#anchorKey = null;
      this.#anchorSuppressed = true;
    }

    if (eff) {
      // Re-base the anchor on a real restore (the write actually moves the
      // position), but not on a same-position persist refresh which must
      // leave the live anchor alone.
      if (this.#setScrollTop(eff.scrollTop)) {
        this.#anchorKey = null;
      }
      this.#setPaging(restoredPagingState(eff, listContextParams));
    } else if (permalinkID) {
      // Clicking an already-visible row just highlights it; a URL / deep-link
      // navigation targets an off-screen (or not-yet-loaded) row, so re-anchor
      // on it and scroll it to the top (in #retryPendingPermalinkScroll).
      const el = this.#el;
      const targetEl = el ? findRow(el, permalinkID) : null;
      let targetVisible = false;
      if (el && targetEl) {
        const vTop = this.#adapter.viewportTop(el);
        targetVisible = rectInViewport(
          targetEl.getBoundingClientRect(),
          vTop,
          vTop + this.#viewportRect(el).height,
        );
      }
      if (!targetVisible) {
        this.#pendingPermalinkScroll = permalinkID;
        if (!targetEl) {
          // The row isn't loaded — re-anchor on it to load its page. (A
          // loaded but off-screen row is left in place and just scrolled to.)
          this.#setPaging(permalinkPagingState(permalinkID, listContextParams));
        }
      }
    } else {
      this.#anchorKey = null;
      this.#setScrollTop(0);
      this.#setPaging({
        estimatedTotal: 0,
        hasReachedStart: true,
        hasReachedEnd: false,
        queryAnchor: {anchor: TOP_ANCHOR as Anchor<TStartRow>, listContextParams},
      });
    }
  }

  // When a URL / deep-link navigation targeted an off-screen permalink row,
  // scroll it to the top once it has rendered. Uses #setScrollTop (not
  // scrollIntoView) so it flags the scroll as programmatic and moves the
  // offset off zero — both needed to stop paging from re-anchoring to the top
  // of the window while the target's context loads. The row can move as rows
  // stream in around it, so retry on each change until loading settles.
  #retryPendingPermalinkScroll(): void {
    const pending = this.#pendingPermalinkScroll;
    if (pending === null) return;
    if (pending !== this.#options.permalinkID) {
      // The permalink changed before we scrolled — drop the stale request.
      this.#pendingPermalinkScroll = null;
      return;
    }
    const el = this.#el;
    if (!el) return;
    const target = findRow(el, pending);
    if (!target) {
      // Not rendered yet — keep the request open and retry once it loads,
      // unless the row genuinely doesn't exist.
      if (this.#rows.permalinkNotFound) {
        this.#pendingPermalinkScroll = null;
      }
      return;
    }
    // Commit any held margin so the target's rect and our write are relative
    // to the real scroll offset, not a shifted layout.
    this.#flushHold();
    const before = this.#scrollOffset(el);
    const delta =
      target.getBoundingClientRect().top - this.#adapter.viewportTop(el);
    if (Math.abs(delta) <= 1) {
      this.#pendingPermalinkScroll = null; // reached the top
      return;
    }
    this.#setScrollTop(before + delta);
    // The row keeps moving as its context streams in (it may briefly clamp
    // short of the top), so keep retrying until loading has settled.
    if (this.#rows.complete) {
      this.#pendingPermalinkScroll = null;
    }
  }

  // One ResizeObserver over the loaded rows, re-attached when the row set
  // changes: catches async row resizes (dynamic heights resolving after
  // layout). border-box so padding/border changes are caught too.
  #reobserveRows(): void {
    const el = this.#el;
    if (!this.#manual() || !el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const items = this.getSnapshot().items;
    if (items === this.#observedItems && this.#resizeObserver) return;
    this.#observedItems = items;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() =>
      this.#withNotify(() => this.#measureAndCompensate()),
    );
    for (const child of queryRows(el)) {
      this.#resizeObserver.observe(child, {box: 'border-box'});
    }
  }

  // ---- paging ----------------------------------------------------------------

  #evaluatePaging(): void {
    const rows = this.#rows;
    if (!this.#isListContextCurrent() || rows.rowsEmpty || !rows.complete) {
      return;
    }
    if (this.#programmaticScroll) return;
    if (this.#pendingPermalinkScroll !== null) {
      // A permalink jump is settling: don't re-anchor to the window edge while
      // the target's context is still loading.
      return;
    }
    const el = this.#el;
    if (!el) return;

    // Which loaded rows are currently visible (by data-index)? Rows are in
    // DOM order, so once one starts below the viewport bottom the rest do too.
    const elTop = this.#adapter.viewportTop(el);
    const elBottom = elTop + this.#viewportRect(el).height;
    let firstVisible = Infinity;
    let lastVisible = -Infinity;
    for (const child of queryRows(el)) {
      const rect = child.getBoundingClientRect();
      if (rect.top >= elBottom) break;
      if (rectInViewport(rect, elTop, elBottom)) {
        const idx = Number(child.getAttribute(VROW_INDEX_ATTR));
        if (idx < firstVisible) firstVisible = idx;
        if (idx > lastVisible) lastVisible = idx;
      }
    }
    // Both distances are 0 when the corresponding edge row is visible.
    const threshold = Math.max(
      this.#options.overscan ?? 5,
      getNearPageEdgeThreshold(this.#pageSize),
    );

    const updateAnchorForEdge = (
      targetIndex: number,
      type: 'forward' | 'backward',
      indexOffset: number,
    ) => {
      const index = toBoundIndex(
        targetIndex,
        rows.firstRowIndex,
        rows.rowsLength,
      );
      const startRow = rows.rowAt(index);
      assert(startRow !== undefined || type === 'forward');
      this.#setAnchor({
        index: index + indexOffset,
        kind: type,
        startRow,
      } as Anchor<TStartRow>);
    };

    if (firstVisible === Infinity) {
      // No loaded row is visible: a far jump (scrollbar drag, instant
      // scrollTop write) put the viewport entirely inside a spacer, so the
      // edge-distance logic below has nothing to react to and paging would
      // stall. Recover: a jump to the very top re-anchors at the start
      // directly; otherwise cascade a page toward the viewport from the
      // nearer edge of the loaded window (cursor-based paging can't teleport
      // to an arbitrary index).
      const first = firstRow(el);
      if (!first) return;
      if (first.getBoundingClientRect().top >= elBottom) {
        // The window is below the viewport — the jump went up.
        if (this.#scrollOffset(el) <= 0) {
          this.#setAnchor(TOP_ANCHOR as Anchor<TStartRow>);
        } else {
          updateAnchorForEdge(rows.firstRowIndex, 'backward', 0);
        }
      } else {
        // The window is above the viewport — the jump went down.
        updateAnchorForEdge(
          rows.firstRowIndex + rows.rowsLength - 1,
          'forward',
          1,
        );
      }
      return;
    }

    if (rows.atStart && rows.firstRowIndex !== 0) {
      this.#setAnchor(TOP_ANCHOR as Anchor<TStartRow>);
      return;
    }

    const distanceFromStart = firstVisible - rows.firstRowIndex;
    const distanceFromEnd =
      rows.firstRowIndex + rows.rowsLength - 1 - lastVisible;

    if (!rows.atStart && distanceFromStart <= threshold) {
      updateAnchorForEdge(lastVisible + 2 * threshold, 'backward', 0);
      return;
    }
    if (!rows.atEnd && distanceFromEnd <= threshold) {
      updateAnchorForEdge(firstVisible - 2 * threshold, 'forward', 1);
    }
  }

  // ---- persistence -----------------------------------------------------------

  #persistKey(): string {
    const s = this.#paging;
    return `${JSON.stringify(s.queryAnchor.anchor)}:${this.#effectiveEstimatedTotal()}:${s.hasReachedStart}:${s.hasReachedEnd}`;
  }

  // Schedule a persist when persist-relevant state changed since the last
  // schedule (the old effect's dependency semantics; scroll events schedule
  // unconditionally via #evaluate → #schedulePersist).
  #schedulePersistIfChanged(): void {
    const key = this.#persistKey();
    if (key !== this.#lastPersistKey) {
      this.#schedulePersist(key);
    }
  }

  #schedulePersist(key = this.#persistKey()): void {
    const {onScrollStateChange} = this.#options;
    if (!this.#isListContextCurrent() || !onScrollStateChange) return;
    this.#lastPersistKey = key;
    // Capture at schedule time (matches the old effect's closure semantics).
    const anchor = this.#paging.queryAnchor.anchor;
    const estimatedTotal = this.#effectiveEstimatedTotal();
    const {hasReachedStart, hasReachedEnd} = this.#paging;
    const {listContextParams} = this.#options;
    clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      const el = this.#el;
      onScrollStateChange({
        anchor,
        // The logical committed offset: if a gesture is mid-flight with an
        // owed jump held in the first-row margin, fold it in so restore lands
        // right.
        scrollTop: el
          ? this.#scrollOffset(el) + this.#anchorState.pendingJump
          : 0,
        estimatedTotal,
        hasReachedStart,
        hasReachedEnd,
        listContextParams,
      });
    }, PERSIST_DEBOUNCE_MS);
  }
}

/**
 * Clamps an index to be within the valid range of rows.
 */
function toBoundIndex(
  targetIndex: number,
  firstRowIndex: number,
  rowsLength: number,
): number {
  if (rowsLength === 0) {
    return firstRowIndex;
  }
  return Math.max(
    firstRowIndex,
    Math.min(firstRowIndex + rowsLength - 1, targetIndex),
  );
}

/**
 * Calculates the threshold for when to trigger loading more rows.
 */
function getNearPageEdgeThreshold(pageSize: number) {
  return Math.ceil(pageSize / 10);
}

function makeEven(n: number) {
  return n % 2 === 0 ? n : n + 1;
}
