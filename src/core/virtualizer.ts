import {assert, unreachable} from '../asserts.ts';
import {memo} from './memo.ts';
import {
  contentWrapper,
  findRow,
  firstRow,
  queryLanes,
  queryRows,
  rectInViewport,
  VROW_INDEX_ATTR,
  VROW_KEY_ATTR,
} from './dom.ts';
import type {Layout, LayoutFactory, LayoutHost} from './layout.ts';
import type {RowsQueryInputs, RowsSnapshot} from './rows.ts';
import {elementScroller, type Scroller, type ScrollRect} from './scroll.ts';
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

// Pages must split evenly around a permalink.
const MIN_PAGE_SIZE = 50;

const NUM_ROWS_FOR_LOADING_SKELETON = 1;

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
 * Where the viewport is going. A `row` (a jump) or an `offset` (a restore)
 * owns the scroll position while it lands: it is put back on every commit
 * until its window has settled, and anchoring compensation, paging and
 * persistence stand down meanwhile (see `#land`). A `probe` is a jump still
 * looking its row up, without disturbing the list. There is one at a time:
 * a newer one replaces the last.
 */
type Target =
  | (PendingScroll & {readonly kind: 'probe'})
  | (PendingScroll & {readonly kind: 'row'})
  | {readonly kind: 'offset'; top: number};

// Anchor and context change atomically so a query never uses a cursor from
// another sort/filter. The remaining fields are exactly what persistence saves.
type PagingState<TListContextParams, TStartRow> = PersistState<TStartRow> & {
  listContextParams: TListContextParams;
};

function restoredPagingState<TListContextParams, TStartRow>(
  state: ScrollHistoryState<TStartRow>,
  listContextParams: TListContextParams,
): PagingState<TListContextParams, TStartRow> {
  return {
    estimatedTotal: state.estimatedTotal,
    hasReachedStart: state.hasReachedStart,
    hasReachedEnd: state.hasReachedEnd,
    anchor: state.anchor,
    listContextParams,
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
    anchor: createPermalinkAnchor(id),
    listContextParams,
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
  /**
   * Lay the rows out as a grid with this many columns (default 1, a plain
   * list) — or, with a `layout`, in this many lanes, as the layout places
   * them. In a grid, rows fill the grid row by row, and each row's
   * {@linkcode VirtualRow.lane} names its column: render the content wrapper
   * as a CSS grid and place each row with `gridColumn: lane + 1`, with the
   * spacers spanning every column (`gridColumn: '1 / -1'`).
   *
   * In a grid, `estimateSize` estimates the height of one grid row,
   * `overscan` counts grid rows, and `spaceBefore` / `spaceAfter` stand in
   * for whole grid rows.
   *
   * A row keeps its column while the list pages, with one exception. A list
   * opened in the middle (a permalink, a far `scrollToItem`), or one that had
   * rows inserted above the loaded window, numbers its rows relatively until
   * paging reaches the true start. When the start loads, the first row has
   * to land in the first column, so every loaded row can shift over once.
   */
  lanes?: number | undefined;
  /**
   * A layout that places the rows itself instead of the list's flow and
   * spacers — `masonryLayout`, which lays the `lanes` out as masonry. A
   * layout keeps the rows on screen in place itself, so `anchoring` is
   * ignored. See {@linkcode LayoutFactory}.
   */
  layout?: LayoutFactory | undefined;
  anchoring?: AnchoringMode | undefined;
  getRowKey: (row: TRow) => RowKey;
  /**
   * Function to extract the start row data from a full row (for pagination
   * anchoring): what `getPageQuery` receives as `start`.
   *
   * The result rides in the paging anchor, which is persisted through
   * `onScrollStateChange` and compared against what comes back. That
   * comparison is `JSON.stringify` unless you supply
   * {@linkcode compareStartRows}, so by default the result must be
   * **JSON-serializable** — a `bigint` from an int64 column is the one to
   * watch for. Either narrow it here (`Number(row.id)`, `String(row.id)`) and
   * widen it again in `getPageQuery`, or hand over the comparator you already
   * sort by.
   */
  toStartRow: (row: TRow) => TStartRow;
  listContextParams: TListContextParams;
  count?: number | undefined;
  permalinkID?: string | null | undefined;
  settleTime?: number | undefined;
  /**
   * Floor for the query page size. The page size is derived from the viewport
   * (about three viewports' worth of rows at `estimateSize`, times `lanes` in
   * a grid), but never drops below this floor. Defaults to 50 — sized for
   * short rows; lower it for tall rows (cards, comments) where 50 rows is
   * many viewports of content.
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
   * what that callback reports back in: by the time a stored state has
   * completed the round trip the viewport has often moved on (a
   * `scrollToItem` landing, a permalink resolving), and re-applying it undoes
   * that. Change this only when the user navigated — a load, a reload, a
   * back/forward. The bundled helpers do exactly that; a custom layer should
   * too. The one echo the core tolerates is its latest write handed straight
   * back, as a store that re-reads what it was just given does (a router's
   * history state, say): that is ignored. An older write arriving later is
   * taken as a restore.
   *
   * Must be JSON-serializable, like the anchor it carries — unless you supply
   * {@linkcode compareStartRows}. See {@linkcode toStartRow}.
   */
  scrollState?: ScrollHistoryState<TStartRow> | null | undefined;
  /**
   * Reports the scroll state to persist: on every scroll event, and when
   * paging moves. Store it on a debounce, and store what is pending before a
   * navigation takes the page elsewhere — otherwise a click while a scroll is
   * still moving leaves the entry being left holding a position from before
   * that scroll. The `useHistoryScrollState` / `createHistoryScrollState`
   * helpers do both.
   */
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
 * The full options the framework bindings accept: the core options plus
 * `getScrollElement` and the query functions
 * ({@linkcode VirtualizerQueryOptions}, whose query types are opaque to the
 * core — the bindings instantiate them with their data layer's query type).
 */
export type VirtualizerBindingOptions<
  TListContextParams,
  TRow,
  TStartRow,
  TPageQuery,
  TPageOptions,
  TSingleQuery,
  TSingleOptions,
> = VirtualizerOptions<TListContextParams, TRow, TStartRow> & {
  /**
   * Returns the element the rows are rendered into. For element scrolling it
   * is also the scroll container; for the window variants the window is the
   * scroll container.
   */
  getScrollElement: () => HTMLElement | null;
} & VirtualizerQueryOptions<
    TStartRow,
    TPageQuery,
    TPageOptions,
    TSingleQuery,
    TSingleOptions
  >;

/**
 * What the framework bindings return: the snapshot plus the current
 * scrolling element (`scrollElement` — `null` until the container is
 * mounted).
 */
export type VirtualizerResult<TRow> = VirtualizerSnapshot<TRow> & {
  readonly scrollElement: HTMLElement | null;
  /**
   * Scroll the row with the given id into view, loading it first if needed.
   * See {@linkcode ZeroVirtualizer.scrollToItem}. Identity is stable for the
   * lifetime of the virtualizer.
   */
  readonly scrollToItem: (id: RowKey, options?: ScrollToItemOptions) => void;
  /**
   * The first / last loaded row currently in the viewport. See
   * {@linkcode ZeroVirtualizer.firstVisibleItem}. Identities are stable for
   * the lifetime of the virtualizer.
   */
  readonly firstVisibleItem: () => VirtualRow<TRow> | undefined;
  readonly lastVisibleItem: () => VirtualRow<TRow> | undefined;
};

/** The core methods {@linkcode virtualizerResult} threads onto the result. */
export type VirtualizerResultMethods<TRow> = {
  scrollToItem: (id: RowKey, options?: ScrollToItemOptions) => void;
  firstVisibleItem: () => VirtualRow<TRow> | undefined;
  lastVisibleItem: () => VirtualRow<TRow> | undefined;
};

/**
 * Builds the binding result from a snapshot. `scrollElement` is a live
 * getter — it resolves at read time, so it is already correct in the effect
 * that mounts the container — and it stays current for any holder of the
 * result object.
 */
export function virtualizerResult<TRow>(
  snapshot: VirtualizerSnapshot<TRow>,
  getScrollElement: () => HTMLElement | null,
  scroller: Scroller,
  methods: VirtualizerResultMethods<TRow>,
): VirtualizerResult<TRow> {
  return {
    ...snapshot,
    ...methods,
    get scrollElement() {
      const el = getScrollElement();
      return el && scroller.resolve(el);
    },
  };
}

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

// DOM resources share one lifetime. Geometry stays live: the container can
// move between reads, and window scrolling always has viewport origin zero.
function createAttachment<TRow>(
  el: HTMLElement,
  scrollElement: HTMLElement,
  manual: boolean,
) {
  const previousOverflowAnchor = scrollElement.style.overflowAnchor;
  scrollElement.style.overflowAnchor = manual ? 'none' : 'auto';
  const cleanups: (void | (() => void))[] = [];
  return {
    el,
    scrollElement,
    manual,
    cleanups,
    rect: {width: 0, height: 0} as ScrollRect,
    resizeObserver: null as ResizeObserver | null,
    observedItems: null as ReadonlyArray<VirtualRow<TRow>> | null,
    get scrollTop(): number {
      return scrollElement.scrollTop;
    },
    get height(): number {
      return this.rect.width > 0 || this.rect.height > 0
        ? this.rect.height
        : scrollElement.clientHeight;
    },
    get viewport(): {top: number; bottom: number} {
      const top =
        scrollElement === document.scrollingElement
          ? 0
          : scrollElement.getBoundingClientRect().top;
      return {top, bottom: top + this.height};
    },
    listen(
      event: 'scrollend' | 'touchstart' | 'touchend' | 'touchcancel',
      handler: () => void,
    ) {
      const target =
        event === 'scrollend' && scrollElement === document.scrollingElement
          ? window
          : scrollElement;
      target.addEventListener(event, handler, {passive: true});
      cleanups.push(() => target.removeEventListener(event, handler));
    },
    detach() {
      for (const cleanup of cleanups) cleanup?.();
      this.resizeObserver?.disconnect();
      scrollElement.style.overflowAnchor = previousOverflowAnchor;
    },
  };
}

type Attachment<TRow> = ReturnType<typeof createAttachment<TRow>>;

/** The slice of paging state a persist writes, for change detection. */
type PersistState<TStartRow> = {
  readonly anchor: Anchor<TStartRow>;
  readonly estimatedTotal: number;
  readonly hasReachedStart: boolean;
  readonly hasReachedEnd: boolean;
};

const EMPTY_ROWS: RowsSnapshot<unknown> = {
  anchor: TOP_ANCHOR,
  pageSize: 0,
  rowAt: () => undefined,
  rowsLength: 0,
  complete: false,
  rowsEmpty: true,
  atStart: false,
  atEnd: false,
  firstRowIndex: 0,
  permalinkNotFound: false,
  lookup: null,
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
  readonly #scroller: Scroller;
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
  readonly #snapshot = memo((_version: number) => this.#buildSnapshot());
  readonly #items = memo(
    (
      rowAt: (index: number) => TRow | undefined,
      first: number,
      length: number,
      getRowKey: (row: TRow) => RowKey,
      lane: (index: number, key: RowKey) => number,
    ): VirtualRow<TRow>[] =>
      Array.from({length}, (_, offset) => {
        const index = first + offset;
        const row = rowAt(index);
        const key = row ? getRowKey(row) : index;
        return {index, key, row, lane: lane(index, key)};
      }),
  );
  // The grid's lane lookup for the items: one function per grid width, so
  // the items memo sees a change (a layout's changes with its assignments).
  readonly #gridLanes = memo(
    (lanes: number) => (index: number) => laneOf(index, lanes),
  );
  // The loaded rows' keys in list order, for the layout.
  readonly #keysOf = memo(
    (rows: RowsSnapshot<TRow>, getRowKey: (row: TRow) => RowKey): string[] =>
      Array.from({length: rows.rowsLength}, (_, offset) => {
        const index = rows.firstRowIndex + offset;
        const row = rows.rowAt(index);
        return String(row ? getRowKey(row) : index);
      }),
  );
  readonly #restorableState = memo(
    (
      state: ScrollHistoryState<TStartRow> | null | undefined,
      context: TListContextParams,
    ) =>
      state &&
      JSON.stringify(state.listContextParams) === JSON.stringify(context)
        ? state
        : null,
  );

  // ---- scroll / anchoring machine (all imperative) --------------------------
  #attachment: Attachment<TRow> | null = null;
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
  // True from a list reset (context change / permalink) until the new
  // window's rows have loaded (see #rowsAnswerQuery), so we don't adopt or pin
  // a reference row laid out in another window.
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
  // The live anchoring state.
  readonly #anchorState = {isScrolling: false, pendingJump: 0};
  // The element currently carrying the held margin (see #holdTarget).
  #holdEl: HTMLElement | null = null;

  #target: Target | null;

  // Consecutive commits the permalink anchor's target has been reported
  // missing for (see #recoverFromMissingPermalink).
  #permalinkMissingCommits = 0;

  // scrollTop as the last scroll event or scroll write reported it, for the
  // layout: reading the live one forces layout, which a layout pass must not
  // do before it has sized the content for what the render removed.
  #reportedScrollTop = 0;
  // The layout the `layout` option plugs in (see ./layout.ts): one instance
  // per factory, created on first use, and what it saw last persisted.
  readonly #layoutOf = memo((factory: LayoutFactory | undefined) =>
    factory?.(this.#layoutHost),
  );
  readonly #layoutHost: LayoutHost = this.#createLayoutHost();
  #persistedLayoutVersion = 0;

  // Restore/reset change tracking (the old effect's dependency semantics).
  #appliedScrollState: ScrollHistoryState<TStartRow> | null = null;
  #appliedPermalinkID: string | null | undefined;
  // Persist-scheduling change detection.
  #lastPersisted: PersistState<TStartRow> | null = null;
  // The last scroll state reported. A host can hand it straight back as
  // `scrollState` (see #restoreOrReset).
  #lastWritten: ScrollHistoryState<TStartRow> | null = null;
  // Settle-timer reset on list-context change (the old effect's dep).
  #lastSettleContext: TListContextParams;
  // One-shot guard for the identity-churn warning below.
  #warnedListContextChurn = false;

  constructor(
    options: VirtualizerOptions<TListContextParams, TRow, TStartRow>,
    scroller: Scroller = elementScroller,
  ) {
    this.#scroller = scroller;
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
            anchor: TOP_ANCHOR,
            listContextParams,
          };
    this.#target =
      permalinkID && !eff
        ? {id: permalinkID, align: 'start', source: 'option', kind: 'row'}
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
    // Another layout places the rows afresh; the reference row is from
    // before.
    if (options.layout !== prev.layout) this.#anchorKey = null;
    this.#options = options;
    // Invalidate only options used by the snapshot. Ingestion stays silent
    // so callers can safely read the updated snapshot during render.
    if (
      prev.count !== options.count ||
      prev.estimateSize !== options.estimateSize ||
      prev.getRowKey !== options.getRowKey ||
      prev.lanes !== options.lanes ||
      prev.layout !== options.layout
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
      probeID: this.#target?.kind === 'probe' ? this.#target.id : null,
    };
  }

  /** Re-render signal for wrappers; returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The current render state. Cached — identity changes only with content. */
  getSnapshot(): VirtualizerSnapshot<TRow> {
    return this.#snapshot(this.#version);
  }

  /**
   * Wire (or re-wire, if the element changed) the scroll container. Idempotent
   * per element; call every commit alongside {@linkcode afterDOMUpdate}.
   */
  attach(el: HTMLElement | null): void {
    // Re-wire for a new anchoring mode too: it sets `overflow-anchor` and the
    // touch listeners, and plugging in a layout switches it.
    if (
      el === (this.#attachment?.el ?? null) &&
      (el === null || this.#attachment?.manual === this.#manual())
    ) {
      return;
    }
    // Re-wiring mid-gesture drops the listeners that would end it, leaving a
    // held correction stranded: end it now.
    if (el !== null && el === this.#attachment?.el) {
      this.#withNotify(() => this.#endScrolling());
    }
    this.detach();
    if (!el) return;

    const scrollElement = this.#scroller.resolve(el);
    const attachment = createAttachment<TRow>(
      el,
      scrollElement,
      this.#manual(),
    );
    // Observers may report synchronously during setup.
    this.#attachment = attachment;
    attachment.cleanups.push(
      this.#scroller.observeRect(scrollElement, rect => {
        attachment.rect = rect;
        this.#withNotify(() => this.#evaluate());
      }),
      this.#scroller.observeOffset(scrollElement, this.#onScrollOffset),
    );
    attachment.listen('scrollend', this.#onScrollEnd);
    // Touch events bubble from the rows to the scroll element.
    if (this.#manual()) {
      attachment.listen('touchstart', this.#onTouchStart);
      attachment.listen('touchend', this.#onTouchEnd);
      attachment.listen('touchcancel', this.#onTouchEnd);
    }
    // Re-attachment can unset settled; notify subscribers of that transition.
    this.#withNotify(() => this.#resetSettleTimer());
  }

  /** Remove all listeners/observers/timers. State survives (Strict Mode). */
  detach(): void {
    this.#attachment?.detach();
    this.#attachment = null;
    clearTimeout(this.#settleTimer);
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
   * **A rendered row can also be addressed by its `getRowKey`.** The value is
   * matched against the rendered rows before any lookup is issued, so passing
   * a key that is on screen scrolls to it and costs no query at all. This is
   * the useful form for keyboard navigation, which holds `items[].key` and may
   * not know the id. Keys are `string | number`, which is why this takes a
   * {@linkcode RowKey}; ids themselves are strings everywhere else in the
   * library, and a number is stringified on the way in.
   *
   * The shortcut reaches rendered rows only. A key for a row that is *not*
   * rendered falls through to the lookup, which reads the string as an id —
   * and unless your keys are also valid ids, nothing resolves and nothing
   * happens. So when the two differ: pass the key when you know the row is on
   * screen, and the id otherwise. Passing the id for a rendered row is always
   * correct too — it costs one single-row lookup, and still scrolls to the row
   * where it stands rather than re-fetching the window around it.
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
  readonly scrollToItem = (id: RowKey, options?: ScrollToItemOptions): void => {
    // DOM keys and lookup ids are strings; numeric row keys are supported too.
    const key = String(id);
    // Empty ids never issue a query and must not leave a request waiting.
    if (key === '') return;
    this.#withNotify(() =>
      this.#startOrScroll({
        id: key,
        align: options?.align ?? 'auto',
        source: 'imperative',
      }),
    );
  };

  /**
   * The first loaded row currently in the viewport, or `undefined` when none
   * is — before the scroll container attaches, or when the viewport sits
   * entirely in the space standing in for rows that haven't loaded.
   *
   * "Visible" here is the same test paging uses to decide when to advance the
   * window: a row counts when its box overlaps the scrollport at all, however
   * slightly. Measured from the DOM at call time, so it reflects the position
   * as it is now rather than as of the last render — call it in the event
   * handler that needs it, not during render.
   *
   * Together with {@linkcode lastVisibleItem} this is what keyboard
   * navigation needs to answer "where am I" without knowing how tall a row is
   * or how many rows precede it. The returned {@linkcode VirtualRow} carries
   * its `key`, which {@linkcode scrollToItem} takes directly.
   *
   * An arrow property, so its identity is stable for the lifetime of the
   * virtualizer and safe to put in a dependency array.
   */
  readonly firstVisibleItem = (): VirtualRow<TRow> | undefined =>
    this.#visibleItem('first');

  /**
   * The last loaded row currently in the viewport — see
   * {@linkcode firstVisibleItem}, of which this is the mirror.
   */
  readonly lastVisibleItem = (): VirtualRow<TRow> | undefined =>
    this.#visibleItem('last');

  // Begin serving a scroll request: scroll now if the target is rendered,
  // otherwise get its page loaded.
  #startOrScroll(request: PendingScroll): void {
    const {id} = request;
    const row: Target = {...request, kind: 'row'};
    // Rendered targets scroll synchronously; no query or later commit is needed.
    const attachment = this.#attachment;
    if (
      attachment !== null &&
      this.#findTarget(attachment.el, request) !== null
    ) {
      // Replacing the target also unsubscribes any superseded lookup.
      this.#setTarget(row);
      this.#land();
      return;
    }
    // Keep a repeated request on its in-flight page. Finished pages need a
    // fresh attempt because no more query commits may arrive.
    if (
      this.#isListContextCurrent() &&
      this.#isTargeting(id) &&
      !this.#rows.complete
    ) {
      this.#setTarget(row);
      return;
    }
    // A permalink window already owns the lookup slot. A normal loaded list
    // gets a probe first, so a nonexistent target cannot empty it.
    if (
      request.rowKey === undefined &&
      this.#paging.anchor.kind !== 'permalink' &&
      !this.#rows.rowsEmpty &&
      this.#isListContextCurrent()
    ) {
      this.#setTarget({...request, kind: 'probe'});
      return;
    }
    this.#setTarget(row);
    this.#anchorKey = null;
    this.#anchorSuppressed = true;
    this.#setPaging(
      permalinkPagingState(request.id, this.#options.listContextParams),
    );
  }

  // A probe is a query input; the other targets are imperative.
  #setTarget(target: Target | null): void {
    if (this.#target?.kind === 'probe' || target?.kind === 'probe') {
      this.#version++;
    }
    this.#target = target;
  }

  // Resolve only the current probe. Missing targets leave the list untouched.
  #resolveProbe(): void {
    const probe = this.#target;
    if (probe?.kind !== 'probe') return;
    if (!this.#isListContextCurrent()) {
      // The list reset under us (sort/filter change): newer intent wins.
      this.#setTarget(null);
      return;
    }
    // A snapshot may still answer a superseded lookup: check its id first.
    const {lookup} = this.#rows;
    if (lookup?.id !== probe.id || !lookup.complete) return;
    if (lookup.row === undefined) {
      this.#setTarget(null); // no such row — do nothing
      return;
    }
    // The lookup supplies the DOM key and proves that re-anchoring is safe.
    this.#startOrScroll({
      ...probe,
      rowKey: this.#options.getRowKey(lookup.row),
    });
  }

  // Try the supplied id/key, then the key established by its lookup.
  #findTarget(el: HTMLElement, request: PendingScroll): HTMLElement | null {
    return (
      findRow(el, request.id) ??
      (request.rowKey !== undefined ? findRow(el, request.rowKey) : null)
    );
  }

  #afterDOMUpdate(): void {
    // Sort/filter changes restart the settle clock.
    if (this.#options.listContextParams !== this.#lastSettleContext) {
      this.#lastSettleContext = this.#options.listContextParams;
      this.#resetSettleTimer();
    }

    // -- layout-effect phase (order preserved from the React hook) --
    this.#measureAndCompensate();
    this.#reobserveRows();
    this.#restoreOrReset();
    // Before landing: a page about to grow still has rows to add.
    this.#updatePageSize();
    this.#land();
    this.#recoverFromMissingPermalink();

    // -- passive-effect phase --
    this.#liftAnchorSuppression();
    this.#updatePaging();
    // Resolve probes after lifting suppression: a new anchor must stay
    // suppressed until the next commit renders its rows.
    this.#resolveProbe();
    this.#evaluatePaging();
    this.#persist(true);
  }

  // ---- derived values --------------------------------------------------------

  // Use the supplied row comparator, falling back to structural equality.
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

  #manual(): boolean {
    // A layout keeps the rows in place itself (masonry, lane by lane, which
    // native anchoring, with its one correction for everything, can't).
    if (this.#layout()) return true;
    const anchoring = this.#options.anchoring ?? 'auto';
    return (
      anchoring === 'manual' ||
      (anchoring === 'auto' && detectNeedsManualAnchoring())
    );
  }

  // Restore only matching contexts. Memoization avoids repeat serialization.
  #effectiveScrollState(): ScrollHistoryState<TStartRow> | null {
    const {scrollState, listContextParams} = this.#options;
    return this.#restorableState(scrollState, listContextParams);
  }

  #isListContextCurrent(): boolean {
    return this.#paging.listContextParams === this.#options.listContextParams;
  }

  // Queries must use the new context immediately, before the reset commits.
  #effectiveAnchor(): Anchor<TStartRow> {
    if (this.#isListContextCurrent()) {
      return this.#paging.anchor;
    }
    const {permalinkID} = this.#options;
    return permalinkID
      ? createPermalinkAnchor(permalinkID)
      : (TOP_ANCHOR as Anchor<TStartRow>);
  }

  // The estimated height of one grid row (of one row, in a plain list).
  #rowEstimate(): number {
    return Math.max(1, this.#options.estimateSize(0));
  }

  #lanes(): number {
    return lanesOf(this.#options);
  }

  #layout(): Layout | undefined {
    return this.#layoutOf(this.#options.layout);
  }

  // What the layout sees of this virtualizer. Getters, so it reads live
  // state as plain properties; built once, before the layout is.
  #createLayoutHost(): LayoutHost {
    // oxlint-disable-next-line no-this-alias
    const self = this;
    return {
      get rows() {
        return self.#rows;
      },
      get keys() {
        return self.#keysOf(self.#rows, self.#options.getRowKey);
      },
      get lanes() {
        return self.#lanes();
      },
      get listContextParams() {
        return self.#options.listContextParams;
      },
      get estimate() {
        return self.#rowEstimate();
      },
      get estimatedTotal() {
        return self.#effectiveEstimatedTotal();
      },
      get settled() {
        return self.#rowsSettled();
      },
      get landing() {
        return self.#landing();
      },
      get el() {
        return self.#attached().el;
      },
      get viewportTop() {
        return self.#attached().viewport.top;
      },
      get viewportHeight() {
        return self.#attached().height;
      },
      get scrollTop() {
        return self.#attached().scrollTop;
      },
      get reportedScrollTop() {
        return self.#reportedScrollTop;
      },
      get pendingJump() {
        return self.#anchorState.pendingJump;
      },
      get restoreScrollTop() {
        const target = self.#target;
        return target?.kind === 'offset' ? target.top : null;
      },
      set restoreScrollTop(top: number | null) {
        const target = self.#target;
        if (target?.kind === 'offset' && top !== null) target.top = top;
      },
      compensate(delta: number) {
        self.#compensate(delta);
      },
      rerender() {
        self.#version++;
      },
    };
  }

  // The layout only runs while attached.
  #attached(): Attachment<TRow> {
    assert(this.#attachment, 'layout called while detached');
    return this.#attachment;
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

    // Estimate unloaded space above and below the rendered window, in grid
    // rows (single rows in a plain list). Row `i` sits in grid row
    // `floor(i / lanes)`; the window's first and last grid rows may be only
    // partly loaded, so the spacers stand in for the whole grid rows outside
    // them.
    const lanes = this.#lanes();
    const rowEstimate = this.#rowEstimate();
    const end = rows.firstRowIndex + rows.rowsLength;
    const gridRowsBefore = Math.floor(Math.max(0, rows.firstRowIndex) / lanes);
    const gridRowsAfter = rows.atEnd
      ? 0
      : Math.max(
          0,
          Math.ceil(effectiveEstimatedTotal / lanes) - Math.ceil(end / lanes),
        );

    // Keep item identity stable while row data, range and key extraction match.
    const layout = this.#layout();
    const items = this.#items(
      rows.rowAt,
      rows.firstRowIndex,
      rows.rowsLength,
      getRowKey,
      layout ? layout.lanes() : this.#gridLanes(lanes),
    );

    const total =
      count ??
      (rows.atStart && rows.atEnd
        ? rows.rowsLength
        : hasReachedStart && hasReachedEnd
          ? estimatedTotal
          : undefined);

    return {
      items,
      // A layout sizes its own content instead.
      spaceBefore: layout || rows.atStart ? 0 : gridRowsBefore * rowEstimate,
      spaceAfter: layout ? 0 : gridRowsAfter * rowEstimate,
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

  // Replace the query anchor without emitting a redundant render.
  #setAnchor(anchor: Anchor<TStartRow>): void {
    const s = this.#paging;
    // Paging can select the same anchor every commit (e.g. a list below the
    // viewport). Equality prevents an infinite notify/render loop.
    if (this.#anchorsEqual(s.anchor, anchor)) {
      return;
    }
    this.#setPaging({...s, anchor});
  }

  // ---- scroll geometry -------------------------------------------------------

  // Where the loaded rows begin: the first row's top, or with a layout,
  // whose lanes start at different heights, the highest first row's.
  #topmostRowTop(attachment: Attachment<TRow>): number | null {
    if (!this.#layout()) {
      return firstRow(attachment.el)?.getBoundingClientRect().top ?? null;
    }
    let top: number | null = null;
    for (const lane of queryLanes(attachment.el)) {
      const first = lane && firstRow(lane);
      if (first) {
        const t = first.getBoundingClientRect().top;
        if (top === null || t < top) top = t;
      }
    }
    return top;
  }

  // Shared visibility definition for paging and public visible-item helpers.
  // Rows are in DOM order, top to bottom, so stop below the viewport — with
  // a layout, lane by lane.
  #visibleIndexRange(
    attachment: Attachment<TRow>,
  ): {first: number; last: number} | null {
    const {top: elTop, bottom: elBottom} = attachment.viewport;
    let first = Infinity;
    let last = -Infinity;
    const columns = this.#layout()
      ? queryLanes(attachment.el).filter(lane => lane !== undefined)
      : [attachment.el];
    for (const column of columns) {
      for (const child of queryRows(column)) {
        const rect = child.getBoundingClientRect();
        if (rect.top >= elBottom) break;
        if (rectInViewport(rect, elTop, elBottom)) {
          const idx = Number(child.getAttribute(VROW_INDEX_ATTR));
          if (idx < first) first = idx;
          if (idx > last) last = idx;
        }
      }
    }
    return first === Infinity ? null : {first, last};
  }

  #visibleItem(edge: 'first' | 'last'): VirtualRow<TRow> | undefined {
    const attachment = this.#attachment;
    if (!attachment) return undefined;
    const range = this.#visibleIndexRange(attachment);
    if (range === null) return undefined;
    // Snapshot items are contiguous from the first loaded index.
    const {items} = this.getSnapshot();
    const base = items[0]?.index;
    return base === undefined ? undefined : items[range[edge] - base];
  }

  // Scroll to an absolute offset, skipping no-op writes (same rounded offset).
  // Returns whether it actually wrote — i.e. whether the position moved.
  #setScrollTop(top: number): boolean {
    const attachment = this.#attachment;
    if (attachment && Math.round(attachment.scrollTop) !== Math.round(top)) {
      this.#programmaticScroll = true;
      attachment.scrollElement.scrollTop = top;
      // As asked for; the scroll event reports what the browser allowed.
      this.#reportedScrollTop = top;
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

  // Hold on the content wrapper, which survives paging. Fall back to the
  // first row when it is directly inside the scroller. A negative margin works
  // where padding would clamp and avoids overwriting consumer spacer styles.
  #holdTarget(attachment: Attachment<TRow>): HTMLElement | null {
    const first = firstRow(attachment.el);
    if (!first) return null;
    const wrapper = contentWrapper(attachment.el);
    return wrapper && wrapper !== attachment.scrollElement ? wrapper : first;
  }

  // A negative margin pulls content up by the pending correction.
  #applyHold(px: number): void {
    const attachment = this.#attachment;
    const target = attachment ? this.#holdTarget(attachment) : null;
    const prev = this.#holdEl;
    if (prev && prev !== target) prev.style.marginTop = '';
    this.#holdEl = px !== 0 ? target : null;
    if (target) target.style.marginTop = px !== 0 ? `${px}px` : '';
  }

  // Transfer a held margin if paging replaces its carrier (first-row fallback).
  #migrateHold(): void {
    if (this.#holdEl === null) return;
    const attachment = this.#attachment;
    const target = attachment ? this.#holdTarget(attachment) : null;
    if (target !== this.#holdEl) {
      this.#applyHold(-this.#anchorState.pendingJump);
    }
  }

  // Content coordinates exclude scrolling and the held margin, so a scrollTop
  // write before its scroll event cannot be mistaken for content movement.
  #anchorOffsetOf(attachment: Attachment<TRow>, rect: DOMRect): number {
    return (
      rect.top -
      attachment.viewport.top +
      attachment.scrollTop +
      this.#anchorState.pendingJump
    );
  }

  #refreshAnchor(): void {
    const attachment = this.#attachment;
    // A layout keeps its rows in place itself.
    if (!attachment || this.#layout()) return;
    const vTop = attachment.viewport.top;
    // Match native anchoring: the first row extending below the viewport top.
    let ref: HTMLElement | null = null;
    for (const child of queryRows(attachment.el)) {
      if (child.getBoundingClientRect().bottom > vTop + 0.5) {
        ref = child;
        break;
      }
    }
    this.#anchorKey = ref?.getAttribute(VROW_KEY_ATTR) ?? null;
    this.#anchorOffset = ref
      ? this.#anchorOffsetOf(attachment, ref.getBoundingClientRect())
      : 0;
  }

  // Apply corrections immediately unless a touch gesture requires a hold.
  #compensate(delta: number): void {
    const attachment = this.#attachment;
    if (!attachment) return;
    // Rebase in content coordinates so this growth is not compensated twice.
    this.#anchorOffset += delta;
    if (this.#anchorState.isScrolling && this.#touchScroll) {
      this.#anchorState.pendingJump += delta;
      this.#applyHold(-this.#anchorState.pendingJump);
    } else {
      this.#setScrollTop(attachment.scrollTop + delta);
    }
  }

  #measureAndCompensate(): void {
    // A layout keeps its rows in place itself, landing or not, and scrolls
    // with them; a reference row would only re-measure the rows the layout
    // moves on purpose.
    const layout = this.#layout();
    if (layout) {
      if (this.#attachment) {
        layout.afterRender();
        // The position now, with the content sized: the next pass starts
        // from it.
        this.#reportedScrollTop = this.#attachment.scrollTop;
      }
      return;
    }
    // A landing or context reset owns the position until its rows arrive.
    if (
      !this.#manual() ||
      this.#anchorSuppressed ||
      !this.#isListContextCurrent() ||
      this.#landing()
    ) {
      return;
    }
    const attachment = this.#attachment;
    if (!attachment) return;
    // Transfer a held margin if paging replaces its carrier (first-row fallback).
    this.#migrateHold();
    // At scrollTop <= 0, reveal prepended content instead of compensating it
    // away (also covers rubber-band overscroll).
    if (attachment.scrollTop <= 0) {
      this.#refreshAnchor();
      return;
    }
    const key = this.#anchorKey;
    const ref = key !== null ? findRow(attachment.el, key) : null;
    if (!ref) {
      // Adopt a reference when the previous row leaves the loaded window.
      this.#refreshAnchor();
      return;
    }
    const delta =
      this.#anchorOffsetOf(attachment, ref.getBoundingClientRect()) -
      this.#anchorOffset;
    if (Math.abs(delta) < 0.5) return;
    this.#compensate(delta);
  }

  // Commit the held correction to scrollTop before clearing its margin.
  #flushHold(): boolean {
    const attachment = this.#attachment;
    if (attachment && this.#anchorState.pendingJump !== 0) {
      this.#setScrollTop(attachment.scrollTop + this.#anchorState.pendingJump);
      this.#anchorState.pendingJump = 0;
      this.#applyHold(0);
      return true;
    }
    return false;
  }

  // End the gesture, commit its hold, and evaluate at the settled position.
  #endScrolling(): void {
    if (!this.#anchorState.isScrolling) return;
    this.#anchorState.isScrolling = false;
    this.#touchScroll = false;
    this.#fingerDown = false;
    this.#flushHold();
    this.#refreshAnchor();
    this.#evaluate();
  }

  // Adopt an anchor only after the reset list has loaded.
  #liftAnchorSuppression(): void {
    if (this.#anchorSuppressed && this.#rowsSettled()) {
      this.#anchorSuppressed = false;
      this.#refreshAnchor();
    }
  }

  // Whether the loaded rows answer the query as it is now: its anchor and its
  // page size. Rows lag the query by at least a commit — every re-anchor
  // leaves the previous window's rows in place until its own arrive, counting
  // positions from somewhere else, and the page size grows once the viewport
  // is measured — so nothing may read them as the current window's until
  // they do.
  #rowsAnswerQuery(): boolean {
    return (
      this.#isListContextCurrent() &&
      this.#rows.pageSize === this.#pageSize &&
      this.#anchorsEqual(
        this.#rows.anchor as Anchor<TStartRow>,
        this.#paging.anchor,
      )
    );
  }

  // The current window is in: answering the query, and complete.
  #rowsSettled(): boolean {
    return this.#rowsAnswerQuery() && this.#rows.complete;
  }

  // A jump to a row, or a restore, owns the scroll position while it lands:
  // anchoring compensation and paging stand down until its window settles.
  #landing(): boolean {
    return this.#target !== null && this.#target.kind !== 'probe';
  }

  // A landing is done: anchoring takes over from where it put the viewport,
  // with a reference adopted now, before anything else can move the rows.
  // And the host hears where that is, having heard nothing while it landed.
  #landed(): void {
    if (!this.#anchorSuppressed) this.#refreshAnchor();
    this.#persist();
  }

  // ---- event handlers --------------------------------------------------------
  // Gesture end is driven by the native `scrollend` event (guaranteed by the
  // supported browsers — see the Safari 26 requirement in the README), plus
  // touch state: a gesture never ends while a finger is down, and a tap that
  // never scrolled ends at touchend (no scrolling → no scrollend).

  #onScrollOffset = (offset: number): void => {
    const programmatic = this.#programmaticScroll;
    this.#programmaticScroll = false;
    this.#reportedScrollTop = offset;
    // The user has taken the position over from a restore still landing.
    if (!programmatic && this.#target?.kind === 'offset') this.#target = null;
    // User/momentum scrolls rebase the anchor; our own scrollTop writes do not.
    if (this.#manual() && !programmatic) {
      this.#anchorState.isScrolling = true;
      this.#gestureScrolled = true;
      this.#refreshAnchor();
    }
    // Include the settled → false transition in the notification batch.
    this.#withNotify(() => {
      this.#resetSettleTimer();
      this.#evaluate();
      this.#persist();
    });
  };

  #onScrollEnd = (): void => {
    if (this.#manual()) {
      // A gesture still under an active finger hasn't really ended.
      if (this.#fingerDown) return;
      this.#withNotify(() => this.#endScrolling());
    }
  };

  #onTouchStart = (): void => {
    this.#fingerDown = true;
    this.#touchScroll = true;
    // Hold even before the first scroll event under an active finger.
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

  // Scroll events evaluate against fresh geometry without a framework render.
  #evaluate(): void {
    this.#updatePageSize();
    this.#evaluatePaging();
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

  // About three viewports of rows: grid rows per viewport, times the rows
  // in each.
  #updatePageSize(): void {
    const min = this.#minPageSize();
    const height = this.#attachment?.height ?? 0;
    const newPageSize =
      height > 0
        ? Math.max(
            min,
            makeEven(
              Math.ceil(height / this.#rowEstimate()) * 3 * this.#lanes(),
            ),
          )
        : min;
    if (newPageSize > this.#pageSize) {
      this.#pageSize = newPageSize;
      this.#version++;
    }
  }

  // Apply the loaded window's extent and relabel its coordinates atomically.
  #updatePaging(): void {
    // Rows answering an earlier query belong to another window: relabelling
    // or extending this one from them corrupts it.
    if (!this.#rowsAnswerQuery()) return;
    const s = this.#paging;
    const rows = this.#rows;
    let {anchor, estimatedTotal} = s;
    const hasReachedStart = s.hasReachedStart || rows.atStart;
    const hasReachedEnd = s.hasReachedEnd || rows.atEnd;
    if (rows.complete) {
      const extent =
        rows.atStart && rows.atEnd
          ? rows.rowsLength
          : rows.firstRowIndex + rows.rowsLength;
      if (extent > estimatedTotal) estimatedTotal = extent;
    }
    if (!rows.rowsEmpty) {
      if (rows.firstRowIndex < 0) {
        // Renumber so the window starts at 0, or below a skeleton grid row
        // when there is more above. Mid-list, the shift is whole grid rows,
        // so no loaded row changes column (lane is index mod lanes).
        const lanes = this.#lanes();
        const offset = rows.atStart
          ? -rows.firstRowIndex
          : lanes *
            (NUM_ROWS_FOR_LOADING_SKELETON +
              Math.ceil(-rows.firstRowIndex / lanes));
        anchor = {...anchor, index: anchor.index + offset};
        estimatedTotal += offset;
      } else if (rows.atStart && rows.firstRowIndex > 0) {
        anchor = TOP_ANCHOR;
        estimatedTotal -= rows.firstRowIndex;
      }
    }
    if (
      anchor !== s.anchor ||
      estimatedTotal !== s.estimatedTotal ||
      hasReachedStart !== s.hasReachedStart ||
      hasReachedEnd !== s.hasReachedEnd
    ) {
      this.#setPaging({
        ...s,
        anchor,
        estimatedTotal,
        hasReachedStart,
        hasReachedEnd,
      });
    }
  }

  // A fresh but structurally equal context usually means an inline literal
  // that resets paging every render. Warn once to make that failure diagnosable.
  #warnOnListContextIdentityChurn(): void {
    if (this.#warnedListContextChurn) return;
    const prev = this.#paging.listContextParams;
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

  // Apply changed restoration/navigation inputs after DOM commit.
  #restoreOrReset(): void {
    const eff = this.#effectiveScrollState();
    const {permalinkID, listContextParams} = this.#options;
    const scrollStateChanged = eff !== this.#appliedScrollState;
    const permalinkChanged = permalinkID !== this.#appliedPermalinkID;

    // Do not mark a restore/permalink applied before attachment: its scroll
    // write would be lost and never retried when the container finally mounts.
    if ((eff || permalinkID) && !this.#attachment) {
      return;
    }

    // The state we last reported, handed straight back (zbugs stores it
    // with `history.replaceState`, which its router re-reads at once): where
    // the list already is, or was before a jump that's landing — not
    // somewhere to put it. Taken as a restore it would land, persist, and
    // come back again, forever.
    if (
      scrollStateChanged &&
      eff !== null &&
      this.#lastWritten !== null &&
      this.#sameScrollState(eff, this.#lastWritten)
    ) {
      this.#appliedScrollState = eff;
      if (!permalinkChanged) return;
    }

    // An imperative jump outranks a restore; record it so it cannot replay later.
    const target = this.#target;
    if (
      target !== null &&
      target.kind !== 'offset' &&
      (target.source === 'imperative' || target.kind === 'probe')
    ) {
      if (this.#isListContextCurrent() && !permalinkChanged) {
        this.#appliedScrollState = eff;
        this.#appliedPermalinkID = permalinkID;
        return;
      }
      // New navigation or a context change supersedes the jump.
      this.#setTarget(null);
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

    // Suppress anchoring until the new context renders its own rows.
    if (!this.#isListContextCurrent()) {
      this.#warnOnListContextIdentityChurn();
      this.#anchorKey = null;
      this.#anchorSuppressed = true;
    }

    if (this.#target?.kind === 'offset') this.#setTarget(null);
    if (eff) {
      this.#setTarget({kind: 'offset', top: eff.scrollTop});
      this.#layout()?.restore(eff.layout);
      // A same-position persistence echo must not disturb the live anchor.
      if (this.#setScrollTop(eff.scrollTop)) {
        this.#anchorKey = null;
      }
      this.#setPaging(restoredPagingState(eff, listContextParams));
    } else if (permalinkID) {
      // Visible permalink targets only highlight; off-screen targets scroll.
      const attachment = this.#attachment;
      const targetEl = attachment ? findRow(attachment.el, permalinkID) : null;
      let targetVisible = false;
      if (attachment && targetEl) {
        const {top, bottom} = attachment.viewport;
        targetVisible = rectInViewport(
          targetEl.getBoundingClientRect(),
          top,
          bottom,
        );
      }
      if (!targetVisible) {
        // Scroll loaded targets in place; probe unloaded targets first.
        const request: PendingScroll = {
          id: permalinkID,
          align: 'start',
          source: 'option',
        };
        if (targetEl) {
          this.#setTarget({...request, kind: 'row'});
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
        anchor: TOP_ANCHOR,
        listContextParams,
      });
    }
  }

  // A missing cold-load permalink has no list to preserve. Fall back to top;
  // jumps over an existing list use a probe and never reach this recovery.
  #recoverFromMissingPermalink(): void {
    const {anchor} = this.#paging;
    if (
      !this.#rows.permalinkNotFound ||
      !this.#isListContextCurrent() ||
      anchor.kind !== 'permalink' ||
      // Ignore stale lookup results from a previous target.
      this.#rows.lookup?.id !== anchor.id
    ) {
      this.#permalinkMissingCommits = 0;
      return;
    }
    if (++this.#permalinkMissingCommits < PERMALINK_MISSING_COMMITS) return;
    this.#permalinkMissingCommits = 0;
    this.#setTarget(null);
    this.#anchorKey = null;
    this.#setPaging({
      estimatedTotal: 0,
      hasReachedStart: true,
      hasReachedEnd: false,
      anchor: TOP_ANCHOR,
      listContextParams: this.#options.listContextParams,
    });
  }

  // Whether the query window is currently hunting for `id` — i.e. the paging
  // anchor is the permalink anchor that loads the page around that row.
  #isTargeting(id: string): boolean {
    const {anchor} = this.#paging;
    return anchor.kind === 'permalink' && anchor.id === id;
  }

  // Compute the requested alignment; the browser clamps at list boundaries.
  #alignDelta(
    attachment: Attachment<TRow>,
    target: HTMLElement,
    align: ScrollAlignment,
  ): number {
    // Inset the scrollport by scroll-padding and outset the row by
    // scroll-margin, matching the platform scroll-into-view geometry.
    const {top: viewportTop, bottom: viewportBottom} = attachment.viewport;
    const padding = getComputedStyle(attachment.scrollElement);
    const top = viewportTop + pixels(padding.scrollPaddingTop);
    const bottom = viewportBottom - pixels(padding.scrollPaddingBottom);
    const margin = getComputedStyle(target);
    const box = target.getBoundingClientRect();
    const rectTop = box.top - pixels(margin.scrollMarginTop);
    const rectBottom = box.bottom + pixels(margin.scrollMarginBottom);

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

  // Land a restore or a jump: put the viewport where it goes on every commit
  // until its window has settled — even when it is in place now: a first
  // write is clamped to the outgoing window's content, and a partial first
  // answer can put the target on top with the rows before it still to land.
  // Our scroll writer flags the motion programmatic, so paging does not
  // replace the target window under it.
  #land(): void {
    const target = this.#target;
    if (target === null || target.kind === 'probe') return;
    if (target.kind === 'offset') {
      if (!this.#rowsAnswerQuery()) return;
      this.#setScrollTop(target.top);
    } else if (!this.#landRow(target)) {
      return;
    }
    if (this.#rowsSettled()) {
      this.#setTarget(null);
      this.#landed();
    }
  }

  // Put a jump's row where it goes, once it is rendered; whether it was.
  #landRow(pending: PendingScroll): boolean {
    if (
      pending.source === 'option' &&
      pending.id !== this.#options.permalinkID
    ) {
      // The permalink changed before we scrolled — drop the stale request.
      this.#setTarget(null);
      return false;
    }
    const attachment = this.#attachment;
    if (!attachment) return false;
    // An id may differ from the DOM key. Adopt only a matching, fully loaded
    // permalink result; stale rows must not retire the current request.
    let el = this.#findTarget(attachment.el, pending);
    if (el === null && pending.rowKey === undefined) {
      // Resolve the DOM key once its own page queries have completed.
      const {lookup, complete} = this.#rows;
      const rowKey =
        lookup?.id === pending.id && lookup.row !== undefined && complete
          ? this.#options.getRowKey(lookup.row)
          : undefined;
      if (rowKey !== undefined) {
        this.#setTarget({...pending, rowKey, kind: 'row'});
        el = findRow(attachment.el, rowKey);
      }
    }
    if (!el) {
      // Keep waiting unless the target is missing or its query was abandoned.
      // A permanently pending request would disable paging and anchoring.
      if (
        (this.#rows.permalinkNotFound &&
          this.#rows.lookup?.id === pending.id) ||
        (this.#rows.complete && !this.#isTargeting(pending.id))
      ) {
        this.#setTarget(null);
      }
      return false;
    }
    // Flush the hold before measuring alignment in real scroll coordinates.
    this.#flushHold();
    const before = attachment.scrollTop;
    const delta = this.#alignDelta(attachment, el, pending.align);
    if (Math.abs(delta) > 1) this.#setScrollTop(before + delta);
    return true;
  }

  // Observe row resizes in manual mode; reattach only when items change.
  #reobserveRows(): void {
    const attachment = this.#attachment;
    if (
      !this.#manual() ||
      !attachment ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }
    const items = this.getSnapshot().items;
    if (items === attachment.observedItems && attachment.resizeObserver) return;
    attachment.observedItems = items;
    attachment.resizeObserver?.disconnect();
    attachment.resizeObserver = new ResizeObserver(() =>
      this.#withNotify(() => this.#measureAndCompensate()),
    );
    for (const child of queryRows(attachment.el)) {
      attachment.resizeObserver.observe(child, {box: 'border-box'});
    }
  }

  // ---- paging ----------------------------------------------------------------

  #evaluatePaging(): void {
    const rows = this.#rows;
    if (!this.#rowsSettled() || rows.rowsEmpty) return;
    if (this.#programmaticScroll) return;
    if (this.#landing()) {
      // A jump or a restore is landing: don't re-anchor to the window edge
      // while its window is still loading.
      return;
    }
    const attachment = this.#attachment;
    if (!attachment) return;

    const visible = this.#visibleIndexRange(attachment);
    const firstVisible = visible?.first ?? Infinity;
    const lastVisible = visible?.last ?? -Infinity;
    const elBottom = attachment.viewport.bottom;
    // Both distances are 0 when the corresponding edge row is visible.
    // `overscan` counts grid rows.
    const threshold = Math.max(
      (this.#options.overscan ?? 5) * this.#lanes(),
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
      const row = rows.rowAt(index);
      assert(row !== undefined || type === 'forward');
      this.#setAnchor({
        index: index + indexOffset,
        kind: type,
        startRow: row === undefined ? undefined : this.#options.toStartRow(row),
      } as Anchor<TStartRow>);
    };

    if (firstVisible === Infinity) {
      // A scrollbar jump into unloaded space needs cursor-based page cascading
      // toward the viewport; there is no index query to teleport there.
      const top = this.#topmostRowTop(attachment);
      if (top === null) return;
      if (top >= elBottom) {
        // A list below the viewport at its start needs no backward page.
        // Otherwise page upward into the unloaded space.
        if (attachment.scrollTop <= 0 || rows.atStart) {
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

    // A page must hold what's visible with room past the threshold on both
    // sides, or paging would flip between the two edges forever: rows far
    // shorter than their estimate, or lanes whose cards on screen are far
    // apart in the list. Grow it, and go by the rows that brings.
    const span = lastVisible - firstVisible + 1;
    if (this.#pageSize < span + 4 * threshold) {
      this.#pageSize = makeEven(span + 4 * threshold);
      this.#version++;
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

  // The persist-relevant slice of paging state: what a persist writes, minus
  // the live scroll offset (which scroll events handle).
  #persistState(): PersistState<TStartRow> {
    const s = this.#paging;
    return {
      anchor: s.anchor,
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

  // Scroll events report every time, DOM commits only when paging changed.
  // Not debounced: only the host knows when the position must be stored by
  // (a navigation, say), so it gets every position and debounces itself.
  #persist(onlyIfChanged = false): void {
    // A landing owns the position until it lands (see #landed). What is on
    // screen meanwhile is neither where the user was nor where they're going.
    if (this.#landing()) return;
    const next = this.#persistState();
    if (
      onlyIfChanged &&
      this.#samePersistState(this.#lastPersisted, next) &&
      this.#persistedLayoutVersion === (this.#layout()?.version ?? 0)
    ) {
      return;
    }
    const {onScrollStateChange, listContextParams} = this.#options;
    const attachment = this.#attachment;
    // Do not persist or record a detached state: a zero offset would clobber
    // the saved position before a lazy container can restore it.
    if (!attachment || !this.#isListContextCurrent() || !onScrollStateChange)
      return;
    const layout = this.#layout();
    this.#lastPersisted = next;
    this.#persistedLayoutVersion = layout?.version ?? 0;
    this.#lastWritten = {
      ...next,
      // The logical committed offset: if a gesture is mid-flight with an owed
      // jump held in the wrapper margin, fold it in so restore lands right.
      scrollTop: attachment.scrollTop + this.#anchorState.pendingJump,
      listContextParams,
      ...(layout && {layout: layout.save()}),
    };
    onScrollStateChange(this.#lastWritten);
  }

  // Whether two scroll states put the viewport in the same place. Only start
  // rows go through `compareStartRows`; the rest is JSON.
  #sameScrollState(
    a: ScrollHistoryState<TStartRow>,
    b: ScrollHistoryState<TStartRow>,
  ): boolean {
    return (
      a.scrollTop === b.scrollTop &&
      this.#samePersistState(a, b) &&
      JSON.stringify(a.listContextParams) ===
        JSON.stringify(b.listContextParams) &&
      JSON.stringify(a.layout) === JSON.stringify(b.layout)
    );
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

/** Grid columns; anything but a finite positive count is a plain list. */
function lanesOf({lanes}: {lanes?: number | undefined}): number {
  return lanes !== undefined && Number.isFinite(lanes) && lanes >= 1
    ? Math.floor(lanes)
    : 1;
}

/** The grid column of row `index`; never negative, even mid-renumbering. */
function laneOf(index: number, lanes: number): number {
  return ((index % lanes) + lanes) % lanes;
}
