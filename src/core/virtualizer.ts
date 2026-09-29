import {assert, unreachable} from '../asserts.ts';
import {memo} from './memo.ts';
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

// Pages must split evenly around a permalink.
const MIN_PAGE_SIZE = 50;

const NUM_ROWS_FOR_LOADING_SKELETON = 1;

// Debounce for persisting scroll state via onScrollStateChange.
const PERSIST_DEBOUNCE_MS = 100;

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
 * Builds the binding result from a snapshot and the resolved scroll wiring.
 * `scrollElement` is a live getter — it resolves at read time, so it is
 * already correct in the effect that mounts the container — and it stays
 * current for any holder of the result object.
 */
export function virtualizerResult<TRow>(
  snapshot: VirtualizerSnapshot<TRow>,
  options: ResolvedScrollOptions,
  resolveScrollElement: ResolveScrollElement,
  methods: VirtualizerResultMethods<TRow>,
): VirtualizerResult<TRow> {
  return {
    ...snapshot,
    options,
    ...methods,
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
  readonly #snapshot = memo((_version: number) => this.#buildSnapshot());
  readonly #items = memo(
    (
      rowAt: (index: number) => TRow | undefined,
      first: number,
      length: number,
      getRowKey: (row: TRow) => RowKey,
    ): VirtualRow<TRow>[] =>
      Array.from({length}, (_, offset) => {
        const index = first + offset;
        const row = rowAt(index);
        return {index, key: row ? getRowKey(row) : index, row};
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

  // A request either probes without disturbing the list or owns the scroll
  // position while its page loads. These phases cannot coexist.
  #request: (PendingScroll & {phase: 'probe' | 'scroll'}) | null;

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
            anchor: TOP_ANCHOR,
            listContextParams,
          };
    this.#request =
      permalinkID && !eff
        ? {id: permalinkID, align: 'start', source: 'option', phase: 'scroll'}
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
    // Invalidate only options used by the snapshot. Ingestion stays silent
    // so callers can safely read the updated snapshot during render.
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
      probeID: this.#request?.phase === 'probe' ? this.#request.id : null,
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
    if (el === (this.#attachment?.el ?? null)) return;
    this.detach();
    if (!el) return;

    const attachment = createAttachment<TRow>(
      el,
      this.#resolveScrollElement(el),
      this.#manual(),
    );
    // Observers may report synchronously during setup.
    this.#attachment = attachment;
    attachment.cleanups.push(
      this.#options.observeElementRect(attachment, rect => {
        attachment.rect = rect;
        this.#withNotify(() => this.#evaluate());
      }),
      this.#options.observeElementOffset(attachment, this.#onScrollOffset),
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
    clearTimeout(this.#persistTimer);
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
    if (request.source === 'imperative') {
      this.#jumpEchoUntil = Date.now() + JUMP_ECHO_WINDOW_MS;
    }
    // Rendered targets scroll synchronously; no query or later commit is needed.
    const attachment = this.#attachment;
    if (
      attachment !== null &&
      this.#findTarget(attachment.el, request) !== null
    ) {
      // Replacing the request also unsubscribes any superseded lookup.
      this.#setRequest(request);
      this.#retryPendingScroll();
      return;
    }
    // Keep a repeated request on its in-flight page. Finished pages need a
    // fresh attempt because no more query commits may arrive.
    if (
      this.#isListContextCurrent() &&
      this.#isTargeting(id) &&
      !this.#rows.complete
    ) {
      this.#setRequest(request);
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
      this.#setRequest(request, 'probe');
      return;
    }
    this.#setRequest(request);
    this.#anchorKey = null;
    this.#anchorSuppressed = true;
    this.#setPaging(
      permalinkPagingState(request.id, this.#options.listContextParams),
    );
  }

  // Probe changes affect query inputs; scroll-phase changes are imperative.
  #setRequest(
    request: PendingScroll | null,
    phase: 'probe' | 'scroll' = 'scroll',
  ): void {
    if (
      this.#request?.phase === 'probe' ||
      (request !== null && phase === 'probe')
    ) {
      this.#version++;
    }
    this.#request = request === null ? null : {...request, phase};
  }

  // Resolve only the current probe. Missing targets leave the list untouched.
  #resolveProbe(): void {
    const probe = this.#request;
    if (probe?.phase !== 'probe') return;
    if (!this.#isListContextCurrent()) {
      // The list reset under us (sort/filter change): newer intent wins.
      this.#setRequest(null);
      return;
    }
    // A snapshot may still answer a superseded lookup: check its id first.
    if (this.#rows.probeID !== probe.id) return;
    if (!this.#rows.probeComplete) return;
    if (this.#rows.probeRow === undefined) {
      this.#setRequest(null); // no such row — do nothing
      return;
    }
    // The lookup supplies the DOM key and proves that re-anchoring is safe.
    this.#startOrScroll({
      ...probe,
      rowKey: this.#options.getRowKey(this.#rows.probeRow),
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
    // Include the landing commit when extending echo protection.
    const wasJumping = this.#request !== null;

    // Sort/filter changes restart the settle clock.
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
    this.#updatePaging();
    // Resolve probes after lifting suppression: a new anchor must stay
    // suppressed until the next commit renders its rows.
    this.#resolveProbe();
    this.#evaluatePaging();
    this.#schedulePersist(true);

    // Cover slow loads and their landing commit, even if the old window expired.
    if (wasJumping || this.#request !== null) {
      this.#jumpEchoUntil = Date.now() + JUMP_ECHO_WINDOW_MS;
    }
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

  // Compare persisted values after host round trips; only row data uses
  // the custom comparator. Context params remain JSON-serializable.
  #sameScrollState(
    a: ScrollHistoryState<TStartRow>,
    b: ScrollHistoryState<TStartRow>,
  ): boolean {
    return (
      a.scrollTop === b.scrollTop &&
      this.#samePersistState(a, b) &&
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

    // Estimate unloaded space above and below the rendered window.
    const rowEstimate = this.#rowEstimate();
    const rowsBefore = Math.max(0, rows.firstRowIndex);
    const rowsAfter = rows.atEnd
      ? 0
      : Math.max(
          0,
          effectiveEstimatedTotal - (rows.firstRowIndex + rows.rowsLength),
        );

    // Keep item identity stable while row data, range and key extraction match.
    const items = this.#items(
      rows.rowAt,
      rows.firstRowIndex,
      rows.rowsLength,
      getRowKey,
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

  // Shared visibility definition for paging and public visible-item helpers.
  // Rows are in DOM order, so stop below the viewport.
  #visibleIndexRange(
    attachment: Attachment<TRow>,
  ): {first: number; last: number} | null {
    const {top: elTop, bottom: elBottom} = attachment.viewport;
    let first = Infinity;
    let last = -Infinity;
    for (const child of queryRows(attachment.el)) {
      const rect = child.getBoundingClientRect();
      if (rect.top >= elBottom) break;
      if (rectInViewport(rect, elTop, elBottom)) {
        const idx = Number(child.getAttribute(VROW_INDEX_ATTR));
        if (idx < first) first = idx;
        if (idx > last) last = idx;
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
    const parent = first.parentElement;
    return parent && parent !== attachment.scrollElement ? parent : first;
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
    if (!attachment) return;
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
    // A jump or context reset owns the position until its rows arrive.
    if (
      !this.#manual() ||
      this.#anchorSuppressed ||
      !this.#isListContextCurrent() ||
      this.#request?.phase === 'scroll'
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
    });
  };

  #onScrollEnd = (): void => {
    if (this.#manual()) {
      // A gesture still under an active finger hasn't really ended.
      if (this.#fingerDown) return;
      this.#withNotify(() => this.#endScrolling());
    }
    // Persist synchronously at scrollend so navigation during the debounce
    // window does not lose the final position.
    this.#persistNow();
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
    const height = this.#attachment?.height ?? 0;
    const newPageSize =
      height > 0
        ? Math.max(min, makeEven(Math.ceil(height / this.#rowEstimate()) * 3))
        : min;
    if (newPageSize > this.#pageSize) {
      this.#pageSize = newPageSize;
      this.#version++;
    }
  }

  // Apply the loaded window's extent and relabel its coordinates atomically.
  #updatePaging(): void {
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
    if (!rows.rowsEmpty && this.#isListContextCurrent()) {
      if (rows.firstRowIndex < 0) {
        const offset =
          -rows.firstRowIndex +
          (rows.atStart ? 0 : NUM_ROWS_FOR_LOADING_SKELETON);
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

    // Ignore recently persisted states echoed by the host during a jump.
    // Outside this window the same values may be a genuine back/forward restore.
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

    // An imperative jump outranks a restore; record it so it cannot replay later.
    if (
      this.#request?.source === 'imperative' ||
      this.#request?.phase === 'probe'
    ) {
      if (this.#isListContextCurrent() && !permalinkChanged) {
        this.#appliedScrollState = eff;
        this.#appliedPermalinkID = permalinkID;
        return;
      }
      // New navigation or a context change supersedes the jump.
      this.#setRequest(null);
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

    if (eff) {
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
          this.#setRequest(request);
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
      this.#rows.permalinkID !== anchor.id
    ) {
      this.#permalinkMissingCommits = 0;
      return;
    }
    if (++this.#permalinkMissingCommits < PERMALINK_MISSING_COMMITS) return;
    this.#permalinkMissingCommits = 0;
    this.#setRequest(null);
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

  // Retry a jump as rows stream in. Use our scroll writer to flag programmatic
  // motion so paging does not immediately replace the target window.
  #retryPendingScroll(): void {
    const pending = this.#request;
    if (pending?.phase !== 'scroll') return;
    if (
      pending.source === 'option' &&
      pending.id !== this.#options.permalinkID
    ) {
      // The permalink changed before we scrolled — drop the stale request.
      this.#setRequest(null);
      return;
    }
    const attachment = this.#attachment;
    if (!attachment) return;
    // An id may differ from the DOM key. Adopt only a matching, fully loaded
    // permalink result; stale rows must not retire the current request.
    let target = this.#findTarget(attachment.el, pending);
    if (target === null && pending.rowKey === undefined) {
      // Resolve the DOM key once its own page queries have completed.
      const {permalinkRow, permalinkID, complete} = this.#rows;
      const rowKey =
        permalinkRow !== undefined && permalinkID === pending.id && complete
          ? this.#options.getRowKey(permalinkRow)
          : undefined;
      if (rowKey !== undefined) {
        this.#setRequest({...pending, rowKey});
        target = findRow(attachment.el, rowKey);
      }
    }
    if (!target) {
      // Keep waiting unless the target is missing or its query was abandoned.
      // A permanently pending request would disable paging and anchoring.
      if (
        (this.#rows.permalinkNotFound &&
          this.#rows.permalinkID === pending.id) ||
        (this.#rows.complete && !this.#isTargeting(pending.id))
      ) {
        this.#setRequest(null);
      }
      return;
    }
    // Flush the hold before measuring alignment in real scroll coordinates.
    this.#flushHold();
    const before = attachment.scrollTop;
    const delta = this.#alignDelta(attachment, target, pending.align);
    if (Math.abs(delta) <= 1) {
      this.#setRequest(null); // in place
      return;
    }
    this.#setScrollTop(before + delta);
    // Keep retrying while surrounding rows are still streaming in.
    if (this.#rows.complete) {
      this.#setRequest(null);
    }
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
    if (!this.#isListContextCurrent() || rows.rowsEmpty || !rows.complete) {
      return;
    }
    if (this.#programmaticScroll) return;
    if (this.#request?.phase === 'scroll') {
      // A jump to a row is settling: don't re-anchor to the window edge while
      // the target's context is still loading.
      return;
    }
    const attachment = this.#attachment;
    if (!attachment) return;

    const visible = this.#visibleIndexRange(attachment);
    const firstVisible = visible?.first ?? Infinity;
    const lastVisible = visible?.last ?? -Infinity;
    const elBottom = attachment.viewport.bottom;
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
      // A scrollbar jump into unloaded space needs cursor-based page cascading
      // toward the viewport; there is no index query to teleport there.
      const first = firstRow(attachment.el);
      if (!first) return;
      if (first.getBoundingClientRect().top >= elBottom) {
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

  // DOM commits schedule only on paging changes; scroll events always debounce.
  #schedulePersist(onlyIfChanged = false): void {
    const next = this.#persistState();
    if (onlyIfChanged && this.#samePersistState(this.#lastPersisted, next))
      return;
    const {onScrollStateChange} = this.#options;
    // Do not persist or record a detached state: a zero offset would clobber
    // the saved position before a lazy container can restore it.
    if (
      !this.#attachment ||
      !this.#isListContextCurrent() ||
      !onScrollStateChange
    ) {
      return;
    }
    this.#lastPersisted = next;
    clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined;
      this.#writeScrollState();
    }, PERSIST_DEBOUNCE_MS);
  }

  // Flush on scrollend, before navigation can lose a debounced position.
  #persistNow(): void {
    clearTimeout(this.#persistTimer);
    this.#persistTimer = undefined;
    this.#lastPersisted = this.#persistState();
    this.#writeScrollState();
  }

  // Read the live position; detachment may have happened since scheduling.
  #writeScrollState(): void {
    const {onScrollStateChange, listContextParams} = this.#options;
    const attachment = this.#attachment;
    if (!attachment || !this.#isListContextCurrent() || !onScrollStateChange)
      return;
    const state: ScrollHistoryState<TStartRow> = {
      ...this.#persistState(),
      // The logical committed offset: if a gesture is mid-flight with an owed
      // jump held in the wrapper margin, fold it in so restore lands right.
      scrollTop: attachment.scrollTop + this.#anchorState.pendingJump,
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
