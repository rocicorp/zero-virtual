import {assert, unreachable} from '../asserts.ts';
import {
  findRow,
  firstRow,
  queryRows,
  rectInViewport,
  VROW_INDEX_ATTR,
  VROW_KEY_ATTR,
} from './dom.ts';
import type {RowsQueryInputs, RowsSnapshot} from './rows.ts';
import type {
  ObserveElementOffset,
  ObserveElementRect,
  ResolvedScrollOptions,
  ResolveScrollElement,
  ScrollRect,
  VirtualizerScrollOptions,
} from './scroll.ts';
import type {
  Anchor,
  AnchoringMode,
  RowKey,
  ScrollAlignment,
  ScrollHistoryState,
  ScrollToItemOptions,
  VirtualizerQueryOptions,
  VirtualRow,
} from './types.ts';

// Make sure this is even since we half it for scroll state loading
const MIN_PAGE_SIZE = 50;

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
 * A scroll-to-a-row request that hasn't landed yet: the target's id, where it
 * should end up, and who asked. `option` requests come from the `permalinkID`
 * option (a URL / deep-link navigation) and are dropped when that option moves
 * on; `imperative` ones come from `scrollToItem` and outrank a restore while
 * they're in flight (see `#restoreOrReset`).
 *
 * While one is pending, paging evaluation and anchoring compensation stand
 * down — the jump owns the scroll position until it settles.
 */
type PendingScroll = {
  readonly id: string;
  readonly align: ScrollAlignment;
  readonly source: 'option' | 'imperative';
  /**
   * The DOM key of the row the id resolved to, once a lookup has answered.
   * Apps routinely address rows by a short id or slug while keying them by
   * something else (a uuid), so this is what actually finds the row in the
   * DOM — `id` alone would miss it.
   */
  readonly rowKey?: RowKey | undefined;
};

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
 * wrappers add `getScrollElement` and the query functions on top — those
 * never reach the core: elements arrive via
 * {@linkcode ZeroVirtualizer.attach} and query results via
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
  /**
   * Floor for the query page size. The page size is derived from the viewport
   * (about three viewports' worth of rows at `estimateSize`), but never drops
   * below this floor. Defaults to 50 — sized for short rows; lower it for
   * tall rows (cards, comments) where 50 rows is many viewports of content.
   * Rounded up to an even number (paging halves pages around permalinks).
   */
  minPageSize?: number | undefined;
  /**
   * Persisted scroll/paging state to restore (e.g. on back/forward). Compared
   * by reference, so it has to be **referentially stable**: a fresh object
   * every render re-applies the restore on every commit and paging never
   * settles. The `useHistoryScrollState` / `createHistoryScrollState` helpers
   * hold one reference per history entry and hand back that same one until
   * the browser navigates; a custom persistence layer has to be as steady.
   *
   * This is an instruction — *put the viewport here* — not a mirror of
   * {@linkcode VirtualizerBindingOptions.onScrollStateChange}. Do not feed
   * what that callback writes back in: by the time a debounced write has
   * completed the round trip the viewport has often moved on (a
   * `scrollToItem` landing, a permalink resolving), and re-applying it undoes
   * that. Change this only when the user navigated — a load, a reload, a
   * back/forward. The bundled helpers do exactly that; a custom layer should
   * too, and the core defends itself against a bounded amount of echo for the
   * ones that don't.
   *
   * Must be JSON-serializable, like the anchor it carries — unless you supply
   * {@linkcode compareStartRows}. See
   * {@linkcode VirtualizerQueryOptions.toStartRow}.
   */
  scrollState?: ScrollHistoryState<TStartRow> | null | undefined;
  onScrollStateChange?:
    | ((state: ScrollHistoryState<TStartRow>) => void)
    | undefined;
  /**
   * Orders two start rows, in the shape Zero's own comparators use: negative,
   * zero, or positive. Only the zero matters here — the virtualizer never
   * sorts, it just needs to know whether two paging anchors point at the same
   * place — but taking that shape means you can hand over the comparator you
   * already sort this list by rather than writing a second one.
   *
   * Without it, start rows are compared with `JSON.stringify`, which means
   * they have to be JSON-serializable. Supply this when they aren't (an int64
   * column read as a `bigint` is the usual reason), or when a structural
   * comparison would be wrong or wasteful for them. With it, a start row JSON
   * can't take survives the round trip through `useHistoryScrollState`, which
   * stores by structured clone and never looks inside what it carries. (The
   * Solid helper is the exception: it round-trips through JSON to turn Zero's
   * store proxies back into plain data.)
   *
   * {@linkcode listContextParams} is compared structurally either way, so it
   * has to be JSON-serializable regardless.
   */
  compareStartRows?: ((a: TStartRow, b: TStartRow) => number) | undefined;
  onSettled?: (() => void) | undefined;
  /**
   * The scroll observers, TanStack Virtual style. Required here; the
   * framework bindings make them optional and default them per entry-point
   * variant (element vs window).
   */
  observeElementRect: ObserveElementRect;
  observeElementOffset: ObserveElementOffset;
};

/** What {@linkcode ZeroVirtualizer.getSnapshot} returns — see the react hook's
 * result docs for field semantics. Cached: identity changes only when content
 * actually changed. */
export type VirtualizerSnapshot<TRow> = {
  items: ReadonlyArray<VirtualRow<TRow>>;
  /**
   * Pixel extent of the unloaded rows above (`spaceBefore`) and below
   * (`spaceAfter`) the loaded window. Render each as a spacer element
   * (`<div style={{height: spaceBefore}} />`) inside the content wrapper, so
   * scroll anchoring keeps the viewport stable as paging changes the space.
   */
  spaceBefore: number;
  spaceAfter: number;
  rowAt: (index: number) => TRow | undefined;
  complete: boolean;
  rowsEmpty: boolean;
  permalinkNotFound: boolean;
  estimatedTotal: number;
  total: number | undefined;
  settled: boolean;
};

/**
 * The full options the framework bindings accept: the core options plus the
 * scroll wiring ({@linkcode VirtualizerScrollOptions}, which also makes the
 * observers optional — the bindings default them per entry-point variant)
 * and the query functions ({@linkcode VirtualizerQueryOptions}, whose query
 * types are opaque to the core — the bindings instantiate them with their
 * data layer's query type).
 */
export type VirtualizerBindingOptions<
  TListContextParams,
  TRow,
  TStartRow,
  TPageQuery,
  TPageOptions,
  TSingleQuery,
  TSingleOptions,
> = Omit<
  VirtualizerOptions<TListContextParams, TRow, TStartRow>,
  'observeElementRect' | 'observeElementOffset'
> &
  VirtualizerScrollOptions &
  VirtualizerQueryOptions<
    TRow,
    TStartRow,
    TPageQuery,
    TPageOptions,
    TSingleQuery,
    TSingleOptions
  >;

/**
 * What the framework bindings return: the snapshot plus, TanStack-style, the
 * resolved scroll wiring (`options`) and the current scrolling element
 * (`scrollElement` — `null` until the container is mounted).
 */
export type VirtualizerResult<TRow> = VirtualizerSnapshot<TRow> & {
  readonly options: ResolvedScrollOptions;
  readonly scrollElement: HTMLElement | null;
  /**
   * Scroll the row with the given id into view, loading it first if needed.
   * See {@linkcode ZeroVirtualizer.scrollToItem}. Identity is stable for the
   * lifetime of the virtualizer.
   */
  readonly scrollToItem: (id: string, options?: ScrollToItemOptions) => void;
};

/**
 * Builds the binding result from a snapshot and the resolved scroll wiring.
 * `scrollElement` is a live getter — it resolves at read time, so it is
 * already correct in the effect that mounts the container — and it stays
 * current for any holder of the result object.
 */
export function virtualizerResult<TRow>(
  snapshot: VirtualizerSnapshot<TRow>,
  options: ResolvedScrollOptions,
  resolveScrollElement: ResolveScrollElement,
  scrollToItem: (id: string, options?: ScrollToItemOptions) => void,
): VirtualizerResult<TRow> {
  return {
    ...snapshot,
    options,
    scrollToItem,
    get scrollElement() {
      const el = options.getScrollElement();
      return el && resolveScrollElement(el);
    },
  };
}

/**
 * How many of the scroll states the core itself wrote are remembered, so they
 * can be recognised when the host hands them back (see `#isOwnScrollState`).
 * A handful covers the round trip: the write is debounced, the host stores it
 * and re-renders, and the one before it can still be in flight behind it.
 */
const OWN_SCROLL_STATES = 4;

/**
 * How long after a jump a scroll state the core wrote itself is still treated
 * as an echo rather than a restore (see `#isOwnScrollState`).
 *
 * The core persists on a debounce and the host stores it and re-renders, so
 * the position captured just *before* a jump can come back well after it — on
 * a cold cache the jump's own pages can take seconds to arrive, and the echo
 * trails them. Long enough to cover that; short enough that a back/forward
 * navigation, which is a deliberate act seconds later at the earliest, is
 * taken at face value. Only states this virtualizer wrote are affected either
 * way.
 */
const JUMP_ECHO_WINDOW_MS = 4000;

/**
 * How many commits in a row a permalink target has to be reported missing
 * before the list gives up on it (see `#recoverFromMissingPermalink`). More
 * than one, because the commit that re-anchors on a new id can still be
 * carrying the *previous* lookup's finished-and-empty result, and giving up on
 * that would throw away a jump that is about to land.
 */
const PERMALINK_MISSING_COMMITS = 2;

/** A computed CSS length in px, or 0 for any other unit (`auto`, `%`). */
function pixels(value: string): number {
  return value.endsWith('px') ? Number.parseFloat(value) || 0 : 0;
}

/** The slice of paging state a persist writes, for change detection. */
type PersistState<TStartRow> = {
  readonly anchor: Anchor<TStartRow>;
  readonly estimatedTotal: number;
  readonly hasReachedStart: boolean;
  readonly hasReachedEnd: boolean;
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
  permalinkRow: undefined,
  permalinkID: null,
  probeID: null,
  probeRow: undefined,
  probeComplete: false,
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
  readonly #resolveScrollElement: ResolveScrollElement;
  #options: VirtualizerOptions<TListContextParams, TRow, TStartRow>;
  #rows: RowsSnapshot<TRow> = EMPTY_ROWS as RowsSnapshot<TRow>;

  // ---- paging state ---------------------------------------------------------
  #paging: PagingState<TListContextParams, TStartRow>;
  // Assigned from #minPageSize() in the constructor (field initializers run
  // before #options is set); grows monotonically in #updatePageSize.
  #pageSize: number;
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
  #scrollElement: HTMLElement | null = null;
  #scrollRect: ScrollRect = {width: 0, height: 0};
  #unsubscribeRect: (() => void) | null = null;
  #unsubscribeOffset: (() => void) | null = null;
  #unsubscribeScrollEnd: (() => void) | null = null;
  #prevOverflowAnchor = '';
  #detachTouch: (() => void) | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #observedItems: ReadonlyArray<VirtualRow<TRow>> | null = null;
  #programmaticScroll = false;

  #anchorKey: RowKey | null = null;
  // The reference row's top position in content (document) coordinates, in
  // the settled (hold-free) frame. Content above the row changing size moves
  // it off this target; the measured delta is what compensation folds back
  // into scrollTop (or the held margin) so the viewport stays visually stable
  // (matching native `overflow-anchor`). Content coordinates, not
  // viewport-relative: scrolling must not read as content movement (see
  // #anchorOffsetOf).
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
  // The live anchoring state.
  readonly #anchorState = {isScrolling: false, pendingJump: 0};
  // The element currently carrying the held margin (see #holdTarget).
  #holdEl: HTMLElement | null = null;

  // The in-flight scroll-to-a-row request, or null. Set by a permalink
  // navigation targeting a row that is NOT currently visible (a permalink
  // pointing at an already-visible row leaves it null — clicking a row never
  // scrolls it), or by {@linkcode ZeroVirtualizer.scrollToItem}.
  #pendingScroll: PendingScroll | null;

  // A scroll request waiting on the single-row lookup that says whether its
  // target exists at all. Held here rather than in #pendingScroll because a
  // probe must not disturb the list: the anchor stays put, and paging and
  // anchoring keep running normally while it resolves. See #startOrScroll.
  #probe: PendingScroll | null = null;

  // Until when a scroll state of our own coming back counts as an echo of the
  // jump rather than a restore (see JUMP_ECHO_WINDOW_MS).
  #jumpEchoUntil = 0;

  // Consecutive commits the permalink anchor's target has been reported
  // missing for (see #recoverFromMissingPermalink).
  #permalinkMissingCommits = 0;

  // The scroll states this virtualizer has written out, most recent first.
  // What comes back as `scrollState` is usually one of them — the host stores
  // what we persist and hands it straight back — and re-applying our own
  // position is at best a no-op. At worst it is the position from *before* a
  // jump arriving after it (the write is debounced and the host re-renders
  // asynchronously), which would re-anchor the list out from under the jump.
  #ownScrollStates: ScrollHistoryState<TStartRow>[] = [];

  // Restore/reset change tracking (the old effect's dependency semantics).
  #appliedScrollState: ScrollHistoryState<TStartRow> | null = null;
  #appliedPermalinkID: string | null | undefined;
  // effectiveScrollState cache, keyed by the identities of its two inputs.
  #effScrollStateKey: readonly [unknown, unknown] | null = null;
  #effScrollState: ScrollHistoryState<TStartRow> | null = null;
  // Persist-scheduling change detection.
  #lastPersisted: PersistState<TStartRow> | null = null;
  // Settle-timer reset on list-context change (the old effect's dep).
  #lastSettleContext: TListContextParams;
  // One-shot guard for the identity-churn warning below.
  #warnedListContextChurn = false;

  constructor(
    options: VirtualizerOptions<TListContextParams, TRow, TStartRow>,
    resolveScrollElement: ResolveScrollElement = el => el,
  ) {
    this.#resolveScrollElement = resolveScrollElement;
    this.#options = options;
    this.#pageSize = this.#minPageSize();
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
    this.#pendingScroll =
      permalinkID && !eff
        ? {id: permalinkID, align: 'start', source: 'option'}
        : null;
    this.#appliedPermalinkID = permalinkID;
    this.#lastSettleContext = listContextParams;
  }

  // ---- wrapper-facing surface ------------------------------------------------

  /** Silent options ingestion — safe to call during render. */
  setOptions(
    options: VirtualizerOptions<TListContextParams, TRow, TStartRow>,
  ): void {
    const prev = this.#options;
    this.#options = options;
    // The snapshot cache is keyed on #version, so invalidate it when an
    // option it derives from changed: `count` feeds `total`/`estimatedTotal`/
    // `rowsEmpty`, `estimateSize` the space estimates, `getRowKey` the item
    // keys. Still silent (no notify) — the caller is mid-render and reads
    // the rebuilt snapshot in the same pass.
    if (
      prev.count !== options.count ||
      prev.estimateSize !== options.estimateSize ||
      prev.getRowKey !== options.getRowKey
    ) {
      this.#version++;
    }
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
      probeID: this.#probe?.id ?? null,
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
    // the scroll element; the rows live inside a padded content wrapper, and
    // native anchoring picks a real row inside it — wrapper padding changes
    // move the row, which is exactly what the browser compensates for.
    const scroller = this.#resolveScrollElement(el);
    this.#scrollElement = scroller;
    this.#prevOverflowAnchor = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = this.#manual() ? 'none' : 'auto';

    const instance = {scrollElement: scroller};
    this.#unsubscribeRect =
      this.#options.observeElementRect(instance, rect => {
        this.#scrollRect = rect;
        this.#withNotify(() => this.#evaluate());
      }) ?? null;
    this.#unsubscribeOffset =
      this.#options.observeElementOffset(instance, this.#onScrollOffset) ??
      null;
    this.#unsubscribeScrollEnd = this.#listenScrollEnd(scroller);
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
    // Wrapped so a settled → false flip on re-attach reaches listeners (same
    // reasoning as in #onScrollOffset).
    this.#withNotify(() => this.#resetSettleTimer());
  }

  /** Remove all listeners/observers/timers. State survives (Strict Mode). */
  detach(): void {
    this.#detachEl();
  }

  #detachEl(): void {
    const el = this.#el;
    if (!el) return;
    this.#unsubscribeRect?.();
    this.#unsubscribeRect = null;
    this.#unsubscribeOffset?.();
    this.#unsubscribeOffset = null;
    this.#unsubscribeScrollEnd?.();
    this.#unsubscribeScrollEnd = null;
    this.#detachTouch?.();
    this.#detachTouch = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#observedItems = null;
    clearTimeout(this.#settleTimer);
    clearTimeout(this.#persistTimer);
    this.#scrollElement?.style.setProperty(
      'overflow-anchor',
      this.#prevOverflowAnchor,
    );
    this.#scrollElement = null;
    this.#scrollRect = {width: 0, height: 0};
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

  /**
   * Scroll the row with the given id into view, loading it first if it isn't
   * in the currently loaded window.
   *
   * `id` is the same identifier the `permalinkID` option takes — what
   * `getSingleQuery` resolves — which need not be the row's `getRowKey`. A row
   * that is already rendered is scrolled to immediately; anything else is
   * looked up first and, if it exists, re-anchors paging on the target
   * (exactly as a permalink navigation does), landing the scroll once its page
   * has loaded. An id that resolves to no row does nothing at all — the list
   * on screen is never given up for a row that isn't there.
   *
   * `options.align` follows TanStack Virtual's `scrollToIndex`: `'auto'` (the
   * default) scrolls the least amount that brings the row into view, or
   * `'start'` / `'center'` / `'end'`. There is no `behavior: 'smooth'`: the
   * scroll is re-applied on every commit while the target's page streams in,
   * which a smooth animation would fight.
   *
   * Unlike the `permalinkID` option this is edge-free: calling it twice with
   * the same id scrolls twice. While the jump is in flight it also outranks a
   * `scrollState` restore, so the viewport isn't yanked back under it.
   *
   * An arrow property, so its identity is stable for the lifetime of the
   * virtualizer and safe to put in a dependency array.
   */
  readonly scrollToItem = (id: string, options?: ScrollToItemOptions): void => {
    // An empty id can't resolve to a row, and the lookup for it is never
    // issued (an empty `probeID` reads as "not probing"), so a request for one
    // would wait on an answer that never comes. Nothing to do.
    if (id === '') return;
    this.#withNotify(() =>
      this.#startOrScroll({
        id,
        align: options?.align ?? 'auto',
        source: 'imperative',
      }),
    );
  };

  // Begin serving a scroll request: scroll now if the target is rendered,
  // otherwise get its page loaded.
  #startOrScroll(request: PendingScroll): void {
    const {id} = request;
    if (request.source === 'imperative') {
      this.#jumpEchoUntil = Date.now() + JUMP_ECHO_WINDOW_MS;
    }
    // A row that is already rendered can be scrolled to right now: no
    // re-query, and nothing for the wrapper to re-render, so there is no later
    // commit to land it on.
    const el = this.#el;
    if (el !== null && findRow(el, id) !== null) {
      // A lookup left over from an earlier request is no longer wanted: its
      // answer would come back a commit or two from now and re-anchor the
      // list onto *that* target, overriding this one.
      this.#dropProbe();
      this.#pendingScroll = request;
      this.#retryPendingScroll();
      return;
    }
    // Already hunting for this id, with its pages still arriving (a repeat
    // call while the first is still in flight): keep the request, but don't
    // reset the list under it — the commits that will land it are already
    // coming. Once that load has finished there are no more commits to wait
    // for, so a repeat call has to go around again rather than sit pending.
    if (
      this.#isListContextCurrent() &&
      this.#isTargeting(id) &&
      !this.#rows.complete
    ) {
      this.#pendingScroll = request;
      return;
    }
    // A newer request supersedes whatever the last one was still doing. What
    // matters for the lookup below is not whether a jump is in flight but
    // whether the window on screen is one: a previous jump that has already
    // re-anchored left a half-loaded permalink window, which is not a list
    // worth protecting, so this request re-anchors straight away. A jump that
    // is still looking its own target up hasn't touched the window yet, so
    // this one goes through the lookup as usual — and replaces that probe.
    const onJumpWindow =
      this.#paging.queryAnchor.anchor.kind === 'permalink' &&
      this.#isListContextCurrent();
    this.#pendingScroll = null;
    // Loading the target's page means re-anchoring on it, which empties the
    // loaded window until the new one arrives — so when there is a list on
    // screen to lose, look the row up first (#probe) and only re-anchor once
    // it is known to exist. An id that resolves to nothing then does nothing
    // at all. With no rows loaded there is nothing to protect, so skip
    // straight to the anchor (this is the deep-link path: one lookup plus the
    // two page queries, not three plus a discarded first page).
    if (
      !onJumpWindow &&
      !this.#rows.rowsEmpty &&
      this.#isListContextCurrent()
    ) {
      this.#probe = request;
      this.#version++;
      return;
    }
    this.#anchorOn(request);
  }

  // Re-anchor paging on the request's target so its page loads, and keep the
  // request open for #retryPendingScroll to land once the row renders.
  #anchorOn(request: PendingScroll): void {
    this.#pendingScroll = request;
    this.#dropProbe();
    this.#anchorKey = null;
    this.#anchorSuppressed = true;
    this.#setPaging(
      permalinkPagingState(request.id, this.#options.listContextParams),
    );
  }

  // The one place `#probe` is cleared. The version bump is what takes
  // `probeID` back out of the query inputs: without it `#withNotify` has
  // nothing to report, the wrapper never re-renders, and the single-row
  // lookup stays subscribed to an id nobody is waiting on any more.
  #dropProbe(): void {
    if (this.#probe !== null) {
      this.#probe = null;
      this.#version++;
    }
  }

  // Act on a finished probe: a target that exists gets its page loaded (or is
  // scrolled to, if it rendered while we were looking it up); one that doesn't
  // is dropped, leaving the list exactly as it was.
  #resolveProbe(): void {
    const probe = this.#probe;
    if (probe === null) return;
    if (!this.#isListContextCurrent()) {
      // The list reset under us (sort/filter change): newer intent wins.
      this.#dropProbe();
      return;
    }
    // The snapshot answers whichever id the lookup ran for, which lags the
    // request it is being read for: a probe replaced earlier in *this* pass
    // (#restoreOrReset can do that) is still facing the previous one's
    // finished result. Taking that as this target's would re-anchor on an id
    // nothing has vouched for — the loaded list thrown away for a row that
    // may not exist at all.
    if (this.#rows.probeID !== probe.id) return;
    if (!this.#rows.probeComplete) return;
    if (this.#rows.probeRow === undefined) {
      this.#dropProbe(); // no such row — do nothing
      return;
    }
    this.#dropProbe();
    // The row exists, and the lookup told us which row it is — so carry its
    // DOM key with the request from here on, for the id-isn't-the-key case.
    const request: PendingScroll = {
      ...probe,
      rowKey: this.#options.getRowKey(this.#rows.probeRow),
    };
    // It may even be rendered already — the window it belongs to was loaded
    // while we were looking it up, or (keyed by something other than the id)
    // it was there all along. Then just scroll: re-anchoring would throw the
    // loaded window away to fetch rows that are already on screen.
    const el = this.#el;
    if (el !== null && this.#findTarget(el, request) !== null) {
      this.#pendingScroll = request;
      this.#retryPendingScroll();
      return;
    }
    this.#anchorOn(request);
  }

  // The request's row in the DOM: by the id it was made with, or by the key its
  // lookup resolved it to. A request that has no key yet picks one up in
  // #retryPendingScroll, once #resolvedRowKey can vouch for it.
  #findTarget(el: HTMLElement, request: PendingScroll): HTMLElement | null {
    return (
      findRow(el, request.id) ??
      (request.rowKey !== undefined ? findRow(el, request.rowKey) : null)
    );
  }

  /**
   * The key of the row the current permalink lookup resolved, when it can be
   * trusted for `id`: the anchor is on that id, and its three queries have all
   * finished — which rules out the window where the snapshot still carries the
   * *previous* target's row, whose key would scroll to the wrong row and
   * retire the request as landed.
   */
  #resolvedRowKey(id: string): RowKey | undefined {
    const {permalinkRow, permalinkID, complete} = this.#rows;
    return permalinkRow !== undefined && permalinkID === id && complete
      ? this.#options.getRowKey(permalinkRow)
      : undefined;
  }

  #afterDOMUpdate(): void {
    // Whether a jump was in flight when this commit began — the commit it
    // lands on retires it before the echo window is refreshed below.
    const wasJumping = this.#pendingScroll !== null || this.#probe !== null;

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
    this.#retryPendingScroll();
    this.#recoverFromMissingPermalink();

    // -- passive-effect phase --
    this.#liftAnchorSuppression();
    this.#updatePageSize();
    this.#applyReachedLatches();
    this.#bumpEstimatedTotal();
    this.#relabelAnchor();
    // After #liftAnchorSuppression, deliberately: acting on a finished probe
    // re-anchors, and that re-anchor's anchoring suppression has to survive
    // into the commit that renders the new window — lifting it in the same
    // pass would adopt a reference row from the outgoing one.
    this.#resolveProbe();
    this.#evaluatePaging();
    this.#schedulePersistIfChanged();

    // The echo window covers the jump plus a moment after it lands, by which
    // time the host has been handed — and handed back — the position it ended
    // on. `wasJumping` is what makes the landing commit count: the request is
    // retired earlier in this pass, and a jump whose pages took longer than
    // the window to arrive would otherwise land with it already expired.
    if (wasJumping || this.#pendingScroll !== null || this.#probe !== null) {
      this.#jumpEchoUntil = Date.now() + JUMP_ECHO_WINDOW_MS;
    }
  }

  // ---- derived values --------------------------------------------------------

  // Whether two start rows point at the same place. `compareStartRows` when
  // the app supplied one — it knows its own rows, and its comparator is the
  // list's own sort order — otherwise a structural compare.
  #startRowsEqual(a: TStartRow | undefined, b: TStartRow | undefined): boolean {
    if (a === b) return true;
    if (a === undefined || b === undefined) return false;
    const {compareStartRows} = this.#options;
    return compareStartRows
      ? compareStartRows(a, b) === 0
      : JSON.stringify(a) === JSON.stringify(b);
  }

  #anchorsEqual(a: Anchor<TStartRow>, b: Anchor<TStartRow>): boolean {
    if (a === b) return true;
    if (a.kind !== b.kind || a.index !== b.index) return false;
    if (a.kind === 'permalink') {
      return a.id === (b as {id: string}).id;
    }
    return this.#startRowsEqual(
      a.startRow,
      (b as {startRow?: TStartRow}).startRow,
    );
  }

  // Content equality for scroll states — the host round-trips them, so this
  // compares by value. The anchor goes through #anchorsEqual; the list-context
  // params are not rows and are always compared structurally.
  #sameScrollState(
    a: ScrollHistoryState<TStartRow>,
    b: ScrollHistoryState<TStartRow>,
  ): boolean {
    return (
      a.scrollTop === b.scrollTop &&
      a.estimatedTotal === b.estimatedTotal &&
      a.hasReachedStart === b.hasReachedStart &&
      a.hasReachedEnd === b.hasReachedEnd &&
      this.#anchorsEqual(a.anchor, b.anchor) &&
      JSON.stringify(a.listContextParams) ===
        JSON.stringify(b.listContextParams)
    );
  }

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

    // Space estimates: the estimated pixel extent of the unloaded rows above
    // and below the loaded window, rendered as the content wrapper's padding
    // (the scrollbar is approximate, exactly as with any virtualized list).
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
    // Skip a re-anchor that changes nothing. #setPaging only guards by object
    // identity and this always builds a fresh paging object, so without this a
    // redundant re-anchor bumps the version → notifies → re-renders → runs
    // afterDOMUpdate → re-anchors again, an infinite loop. #evaluatePaging hits
    // this when the loaded rows sit entirely below the viewport at scroll
    // offset 0 (a window-scrolled list rendered below other page content, at
    // the top of the page): it re-selects the top anchor every commit.
    if (totalDelta === 0 && this.#anchorsEqual(s.queryAnchor.anchor, anchor)) {
      return;
    }
    this.#setPaging({
      ...s,
      estimatedTotal: s.estimatedTotal + totalDelta,
      queryAnchor: {...s.queryAnchor, anchor},
    });
  }

  // ---- scroll geometry -------------------------------------------------------

  #listenScrollEnd(scroller: HTMLElement): () => void {
    const target: HTMLElement | Window =
      scroller === document.scrollingElement ? window : scroller;
    target.addEventListener('scrollend', this.#onScrollEnd);
    return () => target.removeEventListener('scrollend', this.#onScrollEnd);
  }

  #scroller(el: HTMLElement): HTMLElement {
    return this.#scrollElement ?? this.#resolveScrollElement(el);
  }

  #viewportTop(el: HTMLElement): number {
    const scroller = this.#scroller(el);
    return scroller === document.scrollingElement
      ? 0
      : scroller.getBoundingClientRect().top;
  }

  #scrollOffset(el: HTMLElement): number {
    return this.#scroller(el).scrollTop;
  }

  // The scroll container's CSS `scroll-padding-top` / `-bottom`, in px. Any
  // other value reads as 0: `auto` because it means "let the browser decide",
  // and a percentage because the computed value keeps the unit — parsing it as
  // a number would silently inset by that many *pixels*.
  #scrollPadding(el: HTMLElement): {top: number; bottom: number} {
    const scroller = this.#scroller(el);
    const style = getComputedStyle(scroller);
    return {
      top: pixels(style.scrollPaddingTop),
      bottom: pixels(style.scrollPaddingBottom),
    };
  }

  // The target row's CSS `scroll-margin-top` / `-bottom`, in px: the space it
  // asks to keep around itself when scrolled into view.
  #scrollMargin(target: HTMLElement): {top: number; bottom: number} {
    const style = getComputedStyle(target);
    return {
      top: pixels(style.scrollMarginTop),
      bottom: pixels(style.scrollMarginBottom),
    };
  }

  #viewportRect(el: HTMLElement): ScrollRect {
    if (this.#scrollRect.width > 0 || this.#scrollRect.height > 0) {
      return this.#scrollRect;
    }
    const se = this.#scroller(el);
    return {width: se.clientWidth, height: se.clientHeight};
  }

  // Scroll to an absolute offset, skipping no-op writes (same rounded offset).
  // Returns whether it actually wrote — i.e. whether the position moved.
  #setScrollTop(top: number): boolean {
    const el = this.#el;
    if (el && Math.round(this.#scrollOffset(el)) !== Math.round(top)) {
      this.#programmaticScroll = true;
      this.#scroller(el).scrollTop = top;
      return true;
    }
    return false;
  }

  // ---- manual, momentum-safe scroll anchoring --------------------------------
  // Native overflow-anchor is disabled in manual mode, so we keep the viewport
  // visually stable ourselves: pin one keyed "reference" row; whenever the
  // loaded rows change size above it, measure how far it moved and put it back.
  // Idle we fold the correction into scrollTop; during a touch gesture we hold
  // it as a margin-top on the content wrapper — writing scrollTop mid-momentum
  // is ignored / cancels the fling on iOS, while a layout shift is fine — and
  // reconcile margin→scrollTop when the gesture ends.

  // The element that carries the held margin: the rows' content wrapper (it
  // survives paging, unlike the first row). Margin, not the wrapper's padding:
  // the hold is usually negative (pull content up) and padding clamps at 0 —
  // and `padding-top` is the consumer's `spaceBefore` binding, which their
  // next render would clobber. Falls back to the first row itself when rows
  // are direct children of the scroll container, where a margin on it would
  // land outside the scrollable content and shift nothing.
  #holdTarget(el: HTMLElement): HTMLElement | null {
    const first = firstRow(el);
    if (!first) return null;
    const parent = first.parentElement;
    return parent && parent !== this.#scroller(el) ? parent : first;
  }

  // Apply the held correction as a margin-top on the hold target (px is
  // -pendingJump: negative pulls the content up).
  #applyHold(px: number): void {
    const el = this.#el;
    const target = el ? this.#holdTarget(el) : null;
    const prev = this.#holdEl;
    if (prev && prev !== target) prev.style.marginTop = '';
    this.#holdEl = px !== 0 ? target : null;
    if (target) target.style.marginTop = px !== 0 ? `${px}px` : '';
  }

  // If the hold carrier changed while a hold is applied (only possible in the
  // first-row fallback — the wrapper survives paging), move the margin to the
  // new carrier (pre-paint, so nothing shifts visibly).
  #migrateHold(): void {
    if (this.#holdEl === null) return;
    const el = this.#el;
    const target = el ? this.#holdTarget(el) : null;
    if (target !== this.#holdEl) {
      this.#applyHold(-this.#anchorState.pendingJump);
    }
  }

  // A row rect's top position in content (document) coordinates — the scroll
  // offset and the held margin folded out. Content coordinates make the
  // measurement scroll-invariant: a measure landing between a scrollTop write
  // and its scroll event (before #onScrollOffset re-bases the anchor) must not
  // mistake the scroll itself for content movement and "compensate" it away.
  #anchorOffsetOf(el: HTMLElement, rect: DOMRect): number {
    return (
      rect.top -
      this.#viewportTop(el) +
      this.#scrollOffset(el) +
      this.#anchorState.pendingJump
    );
  }

  #refreshAnchor(): void {
    const el = this.#el;
    if (!el) return;
    const vTop = this.#viewportTop(el);
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
  // the content-wrapper margin, owed to the reconcile at gesture end.
  #compensate(delta: number): void {
    const el = this.#el;
    if (!el) return;
    // The target is a content-space position, which neither correction moves
    // (a scrollTop write by definition; the hold's shift is folded back out by
    // #anchorOffsetOf via pendingJump). Re-baseline it so the same growth
    // isn't re-compensated on the next measure.
    this.#anchorOffset += delta;
    if (this.#anchorState.isScrolling && this.#touchScroll) {
      this.#anchorState.pendingJump += delta;
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
      this.#pendingScroll !== null
    ) {
      return;
    }
    const el = this.#el;
    if (!el) return;
    // If the hold carrier changed (first-row fallback only), re-pin it before
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

  #onScrollOffset = (): void => {
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
    // Inside #withNotify so the settled → false version bump is part of the
    // baseline diff — otherwise a scroll that changes nothing else would
    // leave listeners rendering (and querying with) a stale `settled: true`.
    this.#withNotify(() => {
      this.#resetSettleTimer();
      this.#evaluate();
    });
  };

  #onScrollEnd = (): void => {
    if (this.#manual()) {
      // A gesture still under an active finger hasn't really ended.
      if (this.#fingerDown) return;
      this.#withNotify(() => this.#endScrolling());
    }
    // Flush the position the moment scrolling ends, cancelling the pending
    // debounce. The debounce coalesces mid-scroll writes (and keeps us under
    // history-API rate limits), but on its own it loses the position when the
    // user navigates within the debounce window right after stopping — e.g.
    // scrolling a list then clicking a row. `scrollend` is that "stopped"
    // signal, so persist synchronously here.
    this.#persistNow();
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

  // The configured page-size floor: `minPageSize` (evened — paging halves
  // pages around permalinks), defaulting to MIN_PAGE_SIZE.
  #minPageSize(): number {
    const min = this.#options.minPageSize;
    return min === undefined ? MIN_PAGE_SIZE : makeEven(Math.max(2, min));
  }

  #updatePageSize(): void {
    const min = this.#minPageSize();
    const el = this.#el;
    const height = el ? this.#viewportRect(el).height : 0;
    const newPageSize =
      height > 0
        ? Math.max(min, makeEven(Math.ceil(height / this.#rowEstimate()) * 3))
        : min;
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

  // listContextParams is compared by identity: a new reference means "new
  // context" and resets the list. A reference that changed while its content
  // did not is the signature of an un-memoized inline literal (e.g.
  // `listContextParams: {}` recreated every render) — the reset then fires on
  // every commit and pagination can never advance. Warn once so the bug is
  // diagnosable instead of just "the list keeps jumping to the top".
  #warnOnListContextIdentityChurn(): void {
    if (this.#warnedListContextChurn) return;
    const prev = this.#paging.queryAnchor.listContextParams;
    const next = this.#options.listContextParams;

    let prevJSON: string | undefined;
    let nextJSON: string | undefined;
    try {
      prevJSON = JSON.stringify(prev);
      nextJSON = JSON.stringify(next);
    } catch {
      return;
    }

    // If either side can't be represented in JSON, don't attempt this heuristic.
    if (prevJSON === undefined || nextJSON === undefined) return;

    if (prevJSON === nextJSON) {
      this.#warnedListContextChurn = true;
      if (typeof console !== 'undefined') {
        console.warn(
          'zero-virtual: listContextParams changed identity without changing ' +
            'content. It is compared by identity (===) and every change ' +
            'resets the list, so pass a stable reference (a module constant ' +
            'or a memo) instead of recreating the object each render.',
        );
      }
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

    // Restoring a scroll position or resolving a permalink both need the scroll
    // element attached — to write scrollTop, or to locate the target row. If it
    // isn't attached yet (a host that mounts its scroll container lazily, e.g.
    // after measuring available space, attaches it on a later commit), defer
    // *without* recording this state as applied: otherwise the write silently
    // no-ops against the missing element, yet the state counts as applied, so
    // the commit that finally attaches skips the restore as already done. Bail
    // instead, so that later commit actually performs it.
    if ((eff || permalinkID) && !this.#el) {
      return;
    }

    // A jump's own position coming back to us is not a restore: the core
    // persists on a debounce and the host hands the state back a render or two
    // later, so what arrives just after a jump can be the position from just
    // *before* it — and re-anchoring on that would undo the jump. Only within
    // the echo window, and only for a state that changed: outside it an
    // identical-looking state is a genuine navigation (back to a position this
    // virtualizer once persisted) and has to restore.
    if (
      scrollStateChanged &&
      eff !== null &&
      Date.now() < this.#jumpEchoUntil &&
      this.#isOwnScrollState(eff)
    ) {
      this.#appliedScrollState = eff;
      this.#appliedPermalinkID = permalinkID;
      if (!permalinkChanged) return;
    }

    // An in-flight `scrollToItem` owns the scroll position: swallow a restore
    // that would yank the viewport back under it, recording it as applied so
    // it doesn't re-fire once the jump lands.
    if (this.#pendingScroll?.source === 'imperative' || this.#probe !== null) {
      if (this.#isListContextCurrent() && !permalinkChanged) {
        this.#appliedScrollState = eff;
        this.#appliedPermalinkID = permalinkID;
        return;
      }
      // A new permalink, or a list-context change, is newer intent than the
      // jump: it cancels it and falls through.
      this.#pendingScroll = null;
      this.#dropProbe();
    }

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
      this.#warnOnListContextIdentityChurn();
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
        const vTop = this.#viewportTop(el);
        targetVisible = rectInViewport(
          targetEl.getBoundingClientRect(),
          vTop,
          vTop + this.#viewportRect(el).height,
        );
      }
      if (!targetVisible) {
        // A loaded but off-screen row is left in place and just scrolled to;
        // one that isn't loaded needs its page — which, over a list that is
        // already on screen, means looking the row up first so a permalink to
        // an id that doesn't exist leaves that list alone (#startOrScroll).
        const request: PendingScroll = {
          id: permalinkID,
          align: 'start',
          source: 'option',
        };
        if (targetEl) {
          this.#pendingScroll = request;
        } else {
          this.#startOrScroll(request);
        }
      }
    } else {
      this.#anchorKey = null;
      this.#setScrollTop(0);
      this.#setPaging({
        estimatedTotal: 0,
        hasReachedStart: true,
        hasReachedEnd: false,
        queryAnchor: {
          anchor: TOP_ANCHOR as Anchor<TStartRow>,
          listContextParams,
        },
      });
    }
  }

  // A permalink anchor whose target turned out not to exist leaves the query
  // window empty and there is nothing to page from — so fall back to the top
  // of the list. This is the deep-link case (`permalinkID` pointing at a
  // deleted / mistyped id on a cold load); every jump made over a list that
  // was already on screen is probed first and never gets this far.
  #recoverFromMissingPermalink(): void {
    const {anchor} = this.#paging.queryAnchor;
    if (
      !this.#rows.permalinkNotFound ||
      !this.#isListContextCurrent() ||
      anchor.kind !== 'permalink' ||
      // The verdict is about whichever id the lookup ran for. Right after a
      // re-anchor that is still the previous one, and giving up on the list
      // for it would throw away the jump that is on its way in.
      this.#rows.permalinkID !== anchor.id
    ) {
      this.#permalinkMissingCommits = 0;
      return;
    }
    if (++this.#permalinkMissingCommits < PERMALINK_MISSING_COMMITS) return;
    this.#permalinkMissingCommits = 0;
    this.#pendingScroll = null;
    this.#anchorKey = null;
    this.#setPaging({
      estimatedTotal: 0,
      hasReachedStart: true,
      hasReachedEnd: false,
      queryAnchor: {
        anchor: TOP_ANCHOR as Anchor<TStartRow>,
        listContextParams: this.#options.listContextParams,
      },
    });
  }

  // Whether the query window is currently hunting for `id` — i.e. the paging
  // anchor is the permalink anchor that loads the page around that row.
  #isTargeting(id: string): boolean {
    const {anchor} = this.#paging.queryAnchor;
    return anchor.kind === 'permalink' && anchor.id === id;
  }

  // Where the target row should end up, as a delta to add to the current
  // scroll offset. The container clamps the resulting write, so a row near
  // either end of the list lands as close to the requested alignment as it can.
  #alignDelta(
    el: HTMLElement,
    target: HTMLElement,
    align: ScrollAlignment,
  ): number {
    // Both halves of the platform's scroll-into-view contract, which
    // `scrollIntoView` reads and a jump has to match:
    //
    // - the scrollport, inset by the *container's* `scroll-padding` — "this
    //   strip of me is covered", how a sticky header is normally declared;
    // - the target, outset by its own `scroll-margin` — "keep this much space
    //   around me", the per-row way to say the same thing.
    const {top: padTop, bottom: padBottom} = this.#scrollPadding(el);
    const top = this.#viewportTop(el) + padTop;
    const bottom =
      this.#viewportTop(el) + this.#viewportRect(el).height - padBottom;

    const margin = this.#scrollMargin(target);
    const box = target.getBoundingClientRect();
    const rectTop = box.top - margin.top;
    const rectBottom = box.bottom + margin.bottom;

    switch (align) {
      case 'start':
        return rectTop - top;
      case 'end':
        return rectBottom - bottom;
      case 'center':
        return (rectTop + rectBottom) / 2 - (top + bottom) / 2;
      case 'auto':
        // A row taller than the viewport can never be fully visible; top-align
        // it, as `scrollIntoView({block: 'nearest'})` does.
        if (rectBottom - rectTop > bottom - top || rectTop < top) {
          return rectTop - top;
        }
        if (rectBottom > bottom) return rectBottom - bottom;
        return 0;
      default:
        unreachable(align);
    }
  }

  // Land the pending scroll request once its target has rendered. Uses
  // #setScrollTop (not scrollIntoView) so it flags the scroll as programmatic
  // and moves the offset off zero — both needed to stop paging from
  // re-anchoring to the top of the window while the target's context loads.
  // The row can move as rows stream in around it, so retry on each change
  // until loading settles.
  #retryPendingScroll(): void {
    const pending = this.#pendingScroll;
    if (pending === null) return;
    if (
      pending.source === 'option' &&
      pending.id !== this.#options.permalinkID
    ) {
      // The permalink changed before we scrolled — drop the stale request.
      this.#pendingScroll = null;
      return;
    }
    const el = this.#el;
    if (!el) return;
    // The DOM row is keyed by `getRowKey`, which need not equal the target id:
    // apps routinely deep-link by a human-friendly id (a short id / slug) while
    // keying rows by something else (a uuid). See #findTarget for the keys
    // this tries.
    let target = this.#findTarget(el, pending);
    if (target === null && pending.rowKey === undefined) {
      // Rows are keyed by `getRowKey`, which need not equal the id: adopt the
      // key the lookup resolved, once it is safe to (see #resolvedRowKey).
      const rowKey = this.#resolvedRowKey(pending.id);
      if (rowKey !== undefined) {
        this.#pendingScroll = {...pending, rowKey};
        target = findRow(el, rowKey);
      }
    }
    if (!target) {
      // Not rendered yet — keep the request open and retry once it loads,
      // unless the row genuinely doesn't exist, or the list has finished
      // loading with the query no longer hunting for it. Leaving the request
      // pending forever would stand paging and anchoring down for good.
      if (
        (this.#rows.permalinkNotFound &&
          this.#rows.permalinkID === pending.id) ||
        (this.#rows.complete && !this.#isTargeting(pending.id))
      ) {
        this.#pendingScroll = null;
      }
      return;
    }
    // Commit any held margin so the target's rect and our write are relative
    // to the real scroll offset, not a shifted layout.
    this.#flushHold();
    const before = this.#scrollOffset(el);
    const delta = this.#alignDelta(el, target, pending.align);
    if (Math.abs(delta) <= 1) {
      this.#pendingScroll = null; // in place
      return;
    }
    this.#setScrollTop(before + delta);
    // The row keeps moving as its context streams in (it may briefly clamp
    // short of the target), so keep retrying until loading has settled.
    if (this.#rows.complete) {
      this.#pendingScroll = null;
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
    if (this.#pendingScroll !== null) {
      // A jump to a row is settling: don't re-anchor to the window edge while
      // the target's context is still loading.
      return;
    }
    const el = this.#el;
    if (!el) return;

    // Which loaded rows are currently visible (by data-index)? Rows are in
    // DOM order, so once one starts below the viewport bottom the rest do too.
    const elTop = this.#viewportTop(el);
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
      // scrollTop write) put the viewport entirely inside the wrapper's
      // padding, so the
      // edge-distance logic below has nothing to react to and paging would
      // stall. Recover: a jump to the very top re-anchors at the start
      // directly; otherwise cascade a page toward the viewport from the
      // nearer edge of the loaded window (cursor-based paging can't teleport
      // to an arbitrary index).
      const first = firstRow(el);
      if (!first) return;
      if (first.getBoundingClientRect().top >= elBottom) {
        // The loaded window is entirely below the viewport. Two ways to get
        // here: we're at the start of the list, which renders below other page
        // content (a window-scrolled list under a header/detail) and the user
        // hasn't scrolled down to it yet — there is nothing to page, the rows
        // are already loaded and the user scrolls into them; or the viewport
        // jumped up into the padding above a mid-list window, which pages
        // backward toward the viewport. Paging backward at the start would
        // anchor before row 0 and load an empty page, emptying the list.
        if (this.#scrollOffset(el) <= 0 || rows.atStart) {
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

  // The persist-relevant slice of paging state: what a scheduled persist would
  // write, minus the live scroll offset (which scroll events handle).
  #persistState(): PersistState<TStartRow> {
    const s = this.#paging;
    return {
      anchor: s.queryAnchor.anchor,
      estimatedTotal: this.#effectiveEstimatedTotal(),
      hasReachedStart: s.hasReachedStart,
      hasReachedEnd: s.hasReachedEnd,
    };
  }

  #samePersistState(
    a: PersistState<TStartRow> | null,
    b: PersistState<TStartRow>,
  ): boolean {
    return (
      a !== null &&
      a.estimatedTotal === b.estimatedTotal &&
      a.hasReachedStart === b.hasReachedStart &&
      a.hasReachedEnd === b.hasReachedEnd &&
      this.#anchorsEqual(a.anchor, b.anchor)
    );
  }

  // Schedule a persist when persist-relevant state changed since the last
  // schedule (the old effect's dependency semantics; scroll events schedule
  // unconditionally via #evaluate → #schedulePersist).
  #schedulePersistIfChanged(): void {
    const next = this.#persistState();
    if (!this.#samePersistState(this.#lastPersisted, next)) {
      this.#schedulePersist(next);
    }
  }

  #schedulePersist(next: PersistState<TStartRow> = this.#persistState()): void {
    const {onScrollStateChange} = this.#options;
    // With no attached scroll element there is no live scroll position to
    // persist. Skip without recording the state, so the persist still fires once
    // the container attaches. Persisting here would write a spurious
    // scrollTop: 0 over a saved position during the window before a
    // lazily-mounted container attaches — the exact value restore is trying to
    // bring back.
    if (!this.#el || !this.#isListContextCurrent() || !onScrollStateChange) {
      return;
    }
    this.#lastPersisted = next;
    clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined;
      this.#writeScrollState();
    }, PERSIST_DEBOUNCE_MS);
  }

  // Persist the current scroll state immediately, cancelling any pending
  // debounced persist. Called when scrolling ends (`scrollend`): a navigation
  // in the debounce window right after the user stops scrolling must not lose
  // the position.
  #persistNow(): void {
    clearTimeout(this.#persistTimer);
    this.#persistTimer = undefined;
    this.#lastPersisted = this.#persistState();
    this.#writeScrollState();
  }

  // The single persist write. Reads the live position at call time; skips when
  // detached (the element can go away between schedule and fire) — a write
  // then would clobber the saved position with a spurious scrollTop: 0.
  #writeScrollState(): void {
    const {onScrollStateChange, listContextParams} = this.#options;
    const el = this.#el;
    if (!el || !this.#isListContextCurrent() || !onScrollStateChange) return;
    const state: ScrollHistoryState<TStartRow> = {
      anchor: this.#paging.queryAnchor.anchor,
      // The logical committed offset: if a gesture is mid-flight with an owed
      // jump held in the wrapper margin, fold it in so restore lands right.
      scrollTop: this.#scrollOffset(el) + this.#anchorState.pendingJump,
      estimatedTotal: this.#effectiveEstimatedTotal(),
      hasReachedStart: this.#paging.hasReachedStart,
      hasReachedEnd: this.#paging.hasReachedEnd,
      listContextParams,
    };
    this.#ownScrollStates.unshift(state);
    this.#ownScrollStates.length = Math.min(
      this.#ownScrollStates.length,
      OWN_SCROLL_STATES,
    );
    onScrollStateChange(state);
  }

  // Whether this state is one we wrote out ourselves and has simply come back
  // to us (see #ownScrollStates).
  #isOwnScrollState(state: ScrollHistoryState<TStartRow>): boolean {
    return this.#ownScrollStates.some(own => this.#sameScrollState(own, state));
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
