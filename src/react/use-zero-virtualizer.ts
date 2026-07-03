import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {assert} from '../asserts.ts';
import {
  findRow,
  firstRow,
  queryRows,
  rectInViewport,
  VROW_INDEX_ATTR,
  VROW_KEY_ATTR,
} from '../core/dom.ts';
import {
  elementScrollAdapter,
  windowScrollAdapter,
  type ScrollAdapter,
  type ScrollRect,
} from '../core/scroll-adapter.ts';
import type {
  Anchor,
  AnchoringMode,
  GetPageQuery,
  GetSingleQuery,
  RowKey,
  ScrollHistoryState,
  VirtualRow,
} from '../core/types.ts';
import {useRows} from './use-rows.ts';

// Re-exported so the public `./react` entry point is unchanged by the
// core extraction (index.ts re-exports these from here).
export {elementScrollAdapter, windowScrollAdapter};
export type {ScrollAdapter, ScrollRect};
export {rowAttributes} from '../core/dom.ts';
export type {
  AnchoringMode,
  ScrollHistoryState,
  VirtualRow,
} from '../core/types.ts';

// Make sure this is even since we half it for scroll state loading
const MIN_PAGE_SIZE = 100;

const NUM_ROWS_FOR_LOADING_SKELETON = 1;

// After the finger lifts, assume momentum may still be gliding for at least this
// long before an idle-timeout is allowed to conclude the gesture has ended.
const MOMENTUM_GUARD_MS = 180;
// How long the scroll must be quiet (no scroll events) before we treat a gesture
// as ended, when the native `scrollend` event isn't available. Tune on device.
const IDLE_DEBOUNCE_MS = 120;

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

/**
 * Options for configuring the Zero virtualizer.
 *
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination (typically a subset of TRow)
 */
export type UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow> = {
  /**
   * Estimated size (px) of the row at `index`, used to size the spacers that
   * stand in for the not-yet-loaded rows above and below the loaded window.
   * Only an estimate - real row heights come from the DOM.
   */
  estimateSize: (index: number) => number;

  /**
   * Number of extra rows of margin (beyond the viewport) to keep loaded, and
   * how early to trigger loading the next page. Defaults to 5.
   */
  overscan?: number | undefined;

  /** Returns the scrollable container element. */
  getScrollElement: () => HTMLElement | null;

  /**
   * Which anchoring strategy to use (see {@linkcode AnchoringMode}). Defaults to
   * `'auto'`. In `'manual'` mode the virtualizer sets `overflow-anchor: none` on
   * the scroll container and compensates itself; in `'native'` mode it sets
   * `overflow-anchor: auto` and does nothing (the browser handles it). Either
   * way, keep `overflow-anchor: none` on the spacer elements.
   */
  anchoring?: AnchoringMode | undefined;

  /** Function that extracts a stable unique key from a row. */
  getRowKey: (row: TRow) => RowKey;

  /** Parameters that define the list's query context (filters, sort order, etc.) */
  listContextParams: TListContextParams;

  /**
   * Optional exact total row count. When provided it replaces the internal
   * estimate, which gives an accurate and *stable* scrollbar: the scroll extent
   * is fixed up front, so the handle stays put as you scroll.
   *
   * When omitted, the total is unknown and estimated as a high-water mark of the
   * rows discovered so far. That estimate only grows (never projects past what's
   * loaded), so while scrolling forward into new rows the scroll extent keeps
   * extending by ~a page at a time and the native scrollbar handle jumps. This is
   * inherent to an unknown-length list - pass `count` whenever you can get it
   * cheaply (e.g. a count query) to avoid it.
   */
  count?: number | undefined;

  /** Optional ID to highlight/scroll to a specific row (permalink functionality) */
  permalinkID?: string | null | undefined;

  /** Function that returns a query for fetching a page of rows */
  getPageQuery: GetPageQuery<TRow, TStartRow>;
  /** Function that returns a query for fetching a single row by ID */
  getSingleQuery: GetSingleQuery<TRow>;
  /**
   * Time in ms the list must remain unscrolled before it is considered "settled".
   * When settled, query functions receive `{settled: true}` so they can return
   * different options (e.g., longer TTL). Defaults to 2000.
   */
  settleTime?: number | undefined;
  /** Function to extract the start row data from a full row (for pagination anchoring) */
  toStartRow: (row: TRow) => TStartRow;

  /**
   * Optional current scroll state for restoring virtualizer position.
   * If provided along with `onScrollStateChange`, enables state persistence.
   */
  scrollState?: ScrollHistoryState<TStartRow> | null | undefined;
  /**
   * Optional callback invoked when the virtualizer state changes.
   * Use this to persist state (e.g., to browser history, local storage, etc.).
   * Called with the new state approximately 100ms after scroll/pagination changes.
   */
  onScrollStateChange?: (state: ScrollHistoryState<TStartRow>) => void;

  /**
   * Optional callback invoked when the list becomes settled (no scroll
   * activity for `settleTime` ms).
   */
  onSettled?: (() => void) | undefined;

  /**
   * How the scroll container is read and driven. Defaults to
   * {@linkcode elementScrollAdapter} for {@linkcode useZeroVirtualizer} and
   * {@linkcode windowScrollAdapter} for {@linkcode useZeroWindowVirtualizer}.
   * Provide a custom adapter to scroll some other container.
   */
  scrollAdapter?: ScrollAdapter | undefined;
};

const createPermalinkAnchor = (id: string) =>
  ({
    id,
    index: NUM_ROWS_FOR_LOADING_SKELETON,
    kind: 'permalink',
  }) as const;

/**
 * Pairs the paging anchor with the list-context params (sort/filter) it was
 * created under, so the two can only change together. While they disagree with
 * the current props (`!isListContextCurrent` - e.g. right after a sort change
 * or browser back/forward), paging and count updates stand down: we never
 * query with an anchor from one context against the params of another.
 */
type QueryAnchor<TListContextParams, TStartRow> = {
  readonly anchor: Anchor<TStartRow>;
  readonly listContextParams: TListContextParams;
};

/**
 * The virtualizer's pagination state. Kept in a single object so multi-field
 * updates - e.g. relabeling the anchor index together with the estimated total
 * - stay atomic.
 */
type PagingState<TListContextParams, TStartRow> = {
  estimatedTotal: number;
  hasReachedStart: boolean;
  hasReachedEnd: boolean;
  queryAnchor: QueryAnchor<TListContextParams, TStartRow>;
};

// The paging state constructed from a persisted scroll state / a permalink is
// needed twice each: in the useState initializer (mount - avoids Strict Mode
// double-mounting the rows) and in the restore/reset layout effect (post-mount
// navigation). These constructors keep the two sites from drifting.

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
 * Result object returned by the useZeroVirtualizer hook.
 *
 * @typeParam TRow - The type of row data returned from queries
 */
export type ZeroVirtualizerResult<TRow> = {
  /**
   * The loaded rows to render, in order. Render them in normal flow between a
   * top spacer of height {@linkcode spaceBefore} and a bottom spacer of height
   * {@linkcode spaceAfter}. Each row must carry a stable per-row key so its DOM
   * node persists across paging (that identity is what the virtualizer's manual
   * anchoring measures against).
   */
  items: ReadonlyArray<VirtualRow<TRow>>;
  /** Height (px) of the top spacer, standing in for unloaded rows above. */
  spaceBefore: number;
  /** Height (px) of the bottom spacer, standing in for unloaded rows below. */
  spaceAfter: number;
  /** Function to get the row data at a specific index, or undefined if not loaded */
  rowAt: (index: number) => TRow | undefined;
  /** Whether all initially requested data has finished loading */
  complete: boolean;
  /** Whether the list is empty (no rows exist matching the query) */
  rowsEmpty: boolean;
  /** Whether the specified permalinkID was not found in the query results */
  permalinkNotFound: boolean;
  /** Estimated total number of rows (may be inexact until both ends are reached) */
  estimatedTotal: number;
  /** Exact total number of rows, or undefined if not yet known (requires reaching both ends) */
  total: number | undefined;
  /** Whether the list has been unscrolled for at least `settleTime` ms */
  settled: boolean;
  /**
   * Live internal anchoring state, for debugging / demos only (a stable ref; read
   * `.current` - it does not trigger re-renders). Not part of the stable API.
   */
  debug: {
    readonly current: {
      readonly isScrolling: boolean;
      readonly pendingJump: number;
    };
  };
};

/**
 * Hook that creates a virtualized list with bidirectional pagination and state
 * persistence, backed by Zero's reactive queries.
 *
 * Rows are rendered in normal document flow. Native scroll anchoring is turned
 * off; instead the virtualizer keeps the viewport visually stable itself by
 * pinning a reference row and folding any above-viewport size change back into
 * the scroll offset - so loading rows, variable / dynamic heights, and estimate
 * relabels don't shift the visible content.
 *
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
function useZeroVirtualizerImpl<TListContextParams, TRow, TStartRow>(
  {
    estimateSize,
    overscan = 5,
    getScrollElement,
    anchoring = 'auto',
    getRowKey,

    listContextParams,
    count,
    permalinkID,
    getPageQuery,
    getSingleQuery,
    settleTime = 2000,
    toStartRow,

    scrollState,
    onScrollStateChange,
    onSettled,
  }: UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow>,
  adapter: ScrollAdapter,
): ZeroVirtualizerResult<TRow> {
  // Only restore from scrollState if its listContextParams matches the current
  // context. Uses JSON.stringify since scrollState may come from serialized
  // storage (e.g. history.state) where object identity is not preserved.
  const effectiveScrollState = useMemo(() => {
    if (!scrollState) return null;
    if (
      JSON.stringify(scrollState.listContextParams) !==
      JSON.stringify(listContextParams)
    ) {
      return null;
    }
    return scrollState;
  }, [scrollState, listContextParams]);

  // Settled state: flips to true after settleTime ms of no scroll activity.
  const [settled, setSettled] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const resetSettleTimer = useCallback(() => {
    setSettled(false);
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => setSettled(true), settleTime);
  }, [settleTime]);

  // Reset on listContextParams change and on initial mount.
  useEffect(() => {
    resetSettleTimer();
    return () => clearTimeout(settleTimerRef.current);
  }, [resetSettleTimer, listContextParams]);

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  useEffect(() => {
    if (settled) {
      onSettledRef.current?.();
    }
  }, [settled]);

  // Initialize paging state from scrollState directly to avoid Strict Mode double-mount rows
  const [paging, setPaging] = useState<
    PagingState<TListContextParams, TStartRow>
  >(() =>
    effectiveScrollState
      ? restoredPagingState(effectiveScrollState, listContextParams)
      : permalinkID
        ? permalinkPagingState(permalinkID, listContextParams)
        : {
            estimatedTotal: NUM_ROWS_FOR_LOADING_SKELETON,
            hasReachedStart: false,
            hasReachedEnd: false,
            queryAnchor: {anchor: TOP_ANCHOR, listContextParams},
          },
  );
  const {estimatedTotal, hasReachedStart, hasReachedEnd, queryAnchor} = paging;

  // Replace the paging anchor. `totalDelta` grows the estimated total in the
  // same (atomic) update when the anchor change relabels the virtual coordinate
  // space; the manual anchoring re-pins the reference row across the relabel,
  // so the visible content stays put.
  const setAnchor = useCallback((anchor: Anchor<TStartRow>, totalDelta = 0) => {
    setPaging(s => ({
      ...s,
      estimatedTotal: s.estimatedTotal + totalDelta,
      queryAnchor: {...s.queryAnchor, anchor},
    }));
  }, []);

  const isListContextCurrent =
    queryAnchor.listContextParams === listContextParams;

  // Whether to run the manual anchoring machinery (vs. leaving it to native
  // `overflow-anchor`). Resolved once from the `anchoring` option.
  const manual = useMemo(
    () =>
      anchoring === 'manual' ||
      (anchoring === 'auto' && detectNeedsManualAnchoring()),
    [anchoring],
  );

  const anchor = useMemo(() => {
    if (isListContextCurrent) {
      return queryAnchor.anchor;
    }
    return permalinkID ? createPermalinkAnchor(permalinkID) : TOP_ANCHOR;
  }, [isListContextCurrent, queryAnchor.anchor, permalinkID]);

  const [pageSize, setPageSize] = useState(MIN_PAGE_SIZE);

  const {
    rowAt,
    rowsLength,
    complete,
    rowsEmpty,
    atStart,
    atEnd,
    firstRowIndex,
    permalinkNotFound,
  } = useRows({
    pageSize,
    anchor,
    settled,
    getPageQuery,
    getSingleQuery,
    toStartRow,
  });

  const newEstimatedTotal = firstRowIndex + rowsLength;
  // Effective total-row estimate (exact once both ends have been reached).
  const effectiveEstimatedTotal =
    count ??
    (atEnd && atStart && complete
      ? rowsLength
      : Math.max(estimatedTotal, newEstimatedTotal));
  const effectiveRowsEmpty = count === undefined ? rowsEmpty : count === 0;

  // A single representative row-height estimate for the spacers. Real heights
  // come from the DOM; this only approximates the not-yet-loaded extent (so the
  // scrollbar is approximate, exactly as with any virtualized list).
  const rowEstimate = Math.max(1, estimateSize(0));

  // Spacer heights: the estimated pixel extent of the unloaded rows above and
  // below the loaded window.
  const rowsBefore = Math.max(0, firstRowIndex);
  const rowsAfter = atEnd
    ? 0
    : Math.max(0, effectiveEstimatedTotal - (firstRowIndex + rowsLength));
  const spaceBefore = atStart ? 0 : rowsBefore * rowEstimate;
  const spaceAfter = rowsAfter * rowEstimate;

  // The rows to render (the loaded window). Keyed by row id when loaded so their
  // DOM nodes persist across paging - this is what lets scroll anchoring work.
  const items = useMemo<VirtualRow<TRow>[]>(() => {
    const out: VirtualRow<TRow>[] = [];
    for (let i = firstRowIndex; i < firstRowIndex + rowsLength; i++) {
      const row = rowAt(i);
      out.push({
        index: i,
        key: row ? getRowKey(row) : defaultKeyExtractor(i),
        row,
      });
    }
    return out;
  }, [firstRowIndex, rowsLength, rowAt, getRowKey]);

  // Set to a permalink id when we navigate to a row that is NOT currently
  // visible (a URL / deep-link jump), meaning we should scroll to it once it
  // loads. It stays null when a permalink points at an already-visible row (e.g.
  // clicking a visible row), so clicking a row never scrolls it. Initialized for
  // a direct load (`/#id` with no restored scroll state).
  const pendingPermalinkScrollRef = useRef<RowKey | null>(
    permalinkID && !effectiveScrollState ? permalinkID : null,
  );

  const scrollElRef = useRef<HTMLElement | null>(null);
  // Bump on scroll to re-run the paging effect against fresh DOM geometry.
  const [scrollTick, setScrollTick] = useState(0);
  // True while a programmatic scroll (restore / permalink) has been issued but
  // not yet observed, so paging decisions skip a beat.
  const programmaticScrollRef = useRef(false);

  // Accessors derived from the adapter's scroll element.
  const scrollOffset = useCallback(
    (el: HTMLElement) => adapter.scrollElement(el).scrollTop,
    [adapter],
  );
  const viewportRect = useCallback(
    (el: HTMLElement): ScrollRect => {
      const se = adapter.scrollElement(el);
      return {width: se.clientWidth, height: se.clientHeight};
    },
    [adapter],
  );

  // Scroll to an absolute offset, skipping no-op writes (same rounded offset).
  // Returns whether it actually wrote - i.e. whether the position moved.
  const setScrollTop = useCallback(
    (top: number): boolean => {
      const el = scrollElRef.current;
      if (el && Math.round(scrollOffset(el)) !== Math.round(top)) {
        programmaticScrollRef.current = true;
        adapter.scrollElement(el).scrollTop = top;
        return true;
      }
      return false;
    },
    [adapter, scrollOffset],
  );

  // ---- Manual, momentum-safe scroll anchoring --------------------------------
  // Native overflow-anchor is disabled, so we keep the viewport visually stable
  // ourselves. We pin one keyed "reference" row: on scroll we adopt the topmost
  // visible row; whenever the loaded rows change size above it (a row loading, a
  // dynamic height resolving, a spacer/estimate relabel) we measure how far it
  // moved and put it back - the same y1−y0 correction native anchoring made.
  //
  // Where that correction goes depends on whether a touch scroll / momentum is in
  // flight. Idle (incl. desktop mouse/wheel) we fold it into scrollTop. During a
  // touch gesture we instead hold it as a margin-top on the first rendered row -
  // writing scrollTop mid-momentum is ignored / cancels the fling on iOS, while a
  // layout shift is fine - and reconcile margin->scrollTop atomically when the
  // gesture ends.
  const anchorKeyRef = useRef<RowKey | null>(null);
  // The reference row's top offset from the viewport top, in the settled
  // (hold-free) frame - what the anchoring keeps stable across relabels and
  // off-screen resizes (matching native `overflow-anchor`, which anchors to the
  // top of a visible row).
  const anchorOffsetRef = useRef(0);
  // True from a list reset (context change / restore / permalink) until the new
  // data has loaded, so we don't adopt or pin a stale reference row from the
  // outgoing list while it is being replaced.
  const anchorSuppressedRef = useRef(false);
  // Whether the in-flight scroll was initiated by touch. Only then do we take the
  // momentum-safe margin-hold path - plain wheel / trackpad / programmatic scrolls
  // (including the simulator's two-finger scroll) can safely write scrollTop.
  const touchScrollRef = useRef(false);
  const fingerDownRef = useRef(false);
  const momentumGuardUntilRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // The live anchoring state, in one ref that is also returned (read-only) as
  // `debug`: whether a user scroll / momentum is in flight, and the scroll debt
  // owed at the next reconcile (held meanwhile as a margin on the first row).
  const anchorStateRef = useRef({
    isScrolling: false,
    pendingJump: 0,
  });
  // The row element currently carrying the held margin, so it can be migrated
  // when paging swaps the first row out from under it.
  const holdElRef = useRef<HTMLElement | null>(null);

  // Apply the held correction as a margin-top on the first rendered row (px is
  // -pendingJump: negative pulls the content up). A layout shift, not a
  // transform - it composes with normal flow and needs no extra wrapper.
  const applyHold = useCallback((px: number) => {
    const el = scrollElRef.current;
    const first = el ? firstRow(el) : null;
    const prev = holdElRef.current;
    if (prev && prev !== first) prev.style.marginTop = '';
    holdElRef.current = px !== 0 ? first : null;
    if (first) first.style.marginTop = px !== 0 ? `${px}px` : '';
  }, []);

  // If paging replaced the first row while a hold is applied, move the margin
  // to the new first row (pre-paint, so nothing shifts visibly).
  const migrateHold = useCallback(() => {
    const held = holdElRef.current;
    if (held === null) return;
    const el = scrollElRef.current;
    const first = el ? firstRow(el) : null;
    if (first !== held) applyHold(-anchorStateRef.current.pendingJump);
  }, [applyHold]);

  // A row rect's top offset from the viewport top, the held margin folded out -
  // the settled reference-row position the compensation keeps stable.
  const anchorOffsetOf = useCallback(
    (el: HTMLElement, rect: DOMRect) =>
      rect.top - adapter.viewportTop(el) + anchorStateRef.current.pendingJump,
    [adapter],
  );

  const refreshAnchor = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const vTop = adapter.viewportTop(el);
    // Top-most visible row (first whose bottom is below the viewport top), the
    // same reference the browser's native scroll anchoring would pick.
    let ref: HTMLElement | null = null;
    for (const child of queryRows(el)) {
      if (child.getBoundingClientRect().bottom > vTop + 0.5) {
        ref = child;
        break;
      }
    }
    anchorKeyRef.current = ref?.getAttribute(VROW_KEY_ATTR) ?? null;
    anchorOffsetRef.current = ref
      ? anchorOffsetOf(el, ref.getBoundingClientRect())
      : 0;
  }, [adapter, anchorOffsetOf]);

  // The single correction choke point: idle -> scrollTop; mid-gesture -> hold as
  // the first-row margin, owed to the reconcile at gesture end.
  const compensate = useCallback(
    (delta: number) => {
      const el = scrollElRef.current;
      if (!el) return;
      const anchorState = anchorStateRef.current;
      if (anchorState.isScrolling && touchScrollRef.current) {
        // Touch gesture / momentum in flight - never write scrollTop. Owe the
        // delta to a later reconcile and hold it as the first-row margin.
        anchorState.pendingJump += delta;
        // Unlike the scrollTop path (which moves the settled layout back to the
        // target), the hold leaves the reference's settled position shifted by
        // `delta`. Re-baseline the target so we don't keep re-compensating the
        // same growth; the owed jump is flushed at reconcile.
        anchorOffsetRef.current += delta;
        applyHold(-anchorState.pendingJump);
      } else {
        setScrollTop(scrollOffset(el) + delta);
      }
    },
    [applyHold, scrollOffset, setScrollTop],
  );

  const measureAndCompensate = useCallback(() => {
    // Stand down while another mechanism owns the scroll position: a permalink
    // jump scrolling its target to the top, or a list-context (sort/filter)
    // change resetting the list. Compensating against a reference row that is
    // about to be replaced would fight those scrolls.
    if (
      !manual ||
      anchorSuppressedRef.current ||
      !isListContextCurrent ||
      pendingPermalinkScrollRef.current !== null
    ) {
      return;
    }
    const el = scrollElRef.current;
    if (!el) return;
    // If paging swapped out the row carrying the held margin, re-pin it before
    // measuring so the hold isn't double-counted as movement.
    migrateHold();
    // Match native scroll anchoring, which the spec suppresses at scroll offset
    // 0: a prepend there should be *revealed* (push content down), not
    // compensated away. Re-base to the new top row instead of pinning the old
    // one, so a subsequent scroll off 0 stays stable. Keeps manual ~= native at
    // the top edge (a `<= 0` also covers iOS rubber-band overscroll).
    if (scrollOffset(el) <= 0) {
      refreshAnchor();
      return;
    }
    const key = anchorKeyRef.current;
    const ref = key !== null ? findRow(el, key) : null;
    if (!ref) {
      // No valid reference yet, or it scrolled out of the loaded window - adopt
      // the current topmost visible row.
      refreshAnchor();
      return;
    }
    const delta =
      anchorOffsetOf(el, ref.getBoundingClientRect()) - anchorOffsetRef.current;
    if (Math.abs(delta) < 0.5) return;
    compensate(delta);
  }, [
    manual,
    adapter,
    anchorOffsetOf,
    isListContextCurrent,
    refreshAnchor,
    compensate,
  ]);

  // Fold any owed jump into scrollTop while the margin still holds the pixels,
  // then clear the held margin (one paint, no visible jump). Used both to
  // reconcile at the end of a gesture and to make the geometry hold-free before
  // an absolute scroll write (permalink / restore) that would otherwise read and
  // write against a shifted layout.
  const flushHold = useCallback(() => {
    const el = scrollElRef.current;
    const anchorState = anchorStateRef.current;
    if (el && anchorState.pendingJump !== 0) {
      setScrollTop(scrollOffset(el) + anchorState.pendingJump);
      anchorState.pendingJump = 0;
      applyHold(0);
      return true;
    }
    return false;
  }, [applyHold, scrollOffset, setScrollTop]);

  // End of a scroll gesture: reconcile the held margin, re-base the anchor, and
  // nudge paging to re-evaluate at the settled position.
  const endScrolling = useCallback(() => {
    if (!anchorStateRef.current.isScrolling) return;
    anchorStateRef.current.isScrolling = false;
    touchScrollRef.current = false;
    fingerDownRef.current = false;
    clearTimeout(idleTimerRef.current);
    flushHold();
    refreshAnchor();
    setScrollTick(t => t + 1);
  }, [flushHold, refreshAnchor]);

  // Lift anchoring suppression once the reset list has loaded, and adopt a fresh
  // reference from the settled list.
  useEffect(() => {
    if (anchorSuppressedRef.current && isListContextCurrent && complete) {
      anchorSuppressedRef.current = false;
      refreshAnchor();
    }
  }, [isListContextCurrent, complete, refreshAnchor]);

  // Layout (not passive) effect so `scrollElRef` is set before the
  // scroll-restore layout effect below runs on mount. Wires the scroll listener
  // plus the touch / scrollend listeners that drive the is-scrolling machine.
  useLayoutEffect(() => {
    const el = getScrollElement();
    scrollElRef.current = el;
    if (!el) return undefined;

    // Toggle native scroll anchoring to match the resolved mode: off (so it can't
    // fight our compensation) in manual mode, on in native mode. Set on the
    // scroll element; spacers keep their own `overflow-anchor: none` so native
    // mode still anchors to a real row, not a resizing spacer.
    const anchorEl = adapter.scrollElement(el);
    const prevAnchor = anchorEl.style.overflowAnchor;
    anchorEl.style.overflowAnchor = manual ? 'none' : 'auto';

    const scheduleIdleCheck = () => {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(tryEndScroll, IDLE_DEBOUNCE_MS);
    };
    function tryEndScroll() {
      // Never end while a finger is down or momentum may still be gliding - a
      // scrollTop write then would cancel the fling (the classic iOS jolt).
      if (fingerDownRef.current || Date.now() < momentumGuardUntilRef.current) {
        scheduleIdleCheck();
        return;
      }
      endScrolling();
    }

    const onScroll = () => {
      const programmatic = programmaticScrollRef.current;
      programmaticScrollRef.current = false;
      // Manual anchoring only: a user / momentum scroll (not our own compensation
      // / reconcile / restore / permalink write) marks us as scrolling - via
      // scroll events, not only touchstart, so it also fires for trackpad / wheel
      // / simulator scrolling that emits no touch events - and re-bases the anchor.
      if (manual && !programmatic) {
        anchorStateRef.current.isScrolling = true;
        refreshAnchor();
        if (!fingerDownRef.current) scheduleIdleCheck();
      }
      resetSettleTimer();
      setScrollTick(t => t + 1);
    };
    const onTouchStart = () => {
      fingerDownRef.current = true;
      touchScrollRef.current = true;
      anchorStateRef.current.isScrolling = true;
      clearTimeout(idleTimerRef.current);
    };
    const onTouchEnd = () => {
      fingerDownRef.current = false;
      momentumGuardUntilRef.current = Date.now() + MOMENTUM_GUARD_MS;
      scheduleIdleCheck();
    };
    const onScrollEnd = () => {
      if (!fingerDownRef.current) endScrolling();
    };

    // scroll / scrollend attach per the adapter (they don't bubble); touch
    // events bubble, so the scroll element hears every touch inside it. The
    // touch / scrollend machinery only drives manual mode.
    const unsub = adapter.subscribe(
      el,
      onScroll,
      manual ? onScrollEnd : () => {},
    );
    const touchTarget = anchorEl;
    if (manual) {
      touchTarget.addEventListener('touchstart', onTouchStart, {passive: true});
      touchTarget.addEventListener('touchend', onTouchEnd, {passive: true});
      touchTarget.addEventListener('touchcancel', onTouchEnd, {passive: true});
    }
    return () => {
      unsub();
      if (manual) {
        touchTarget.removeEventListener('touchstart', onTouchStart);
        touchTarget.removeEventListener('touchend', onTouchEnd);
        touchTarget.removeEventListener('touchcancel', onTouchEnd);
      }
      clearTimeout(idleTimerRef.current);
      anchorEl.style.overflowAnchor = prevAnchor;
    };
  }, [
    getScrollElement,
    adapter,
    manual,
    refreshAnchor,
    endScrolling,
    resetSettleTimer,
  ]);

  // Re-pin the reference row after every render-driven layout change (paging,
  // anchor relabels, spacer resize) - this runs after DOM commit, before paint,
  // so the correction is jump-free.
  useLayoutEffect(() => {
    measureAndCompensate();
  }, [items, spaceBefore, spaceAfter, measureAndCompensate]);

  // ...and after async row resizes (dynamic heights resolving after layout). One
  // ResizeObserver over the loaded rows; re-attached when the row set changes.
  useLayoutEffect(() => {
    const el = scrollElRef.current;
    if (!manual || !el) return undefined;
    const ro = new ResizeObserver(() => measureAndCompensate());
    for (const child of queryRows(el)) {
      // border-box: the row's laid-out size (what its rect reflects), so padding
      // / border changes are caught too, not just content reflow.
      ro.observe(child, {box: 'border-box'});
    }
    return () => ro.disconnect();
  }, [manual, items, measureAndCompensate]);

  // Keep page size large enough to fill the viewport ~3x.
  useEffect(() => {
    const el = getScrollElement();
    const height = el ? viewportRect(el).height : 0;
    const newPageSize =
      height > 0
        ? Math.max(MIN_PAGE_SIZE, makeEven(Math.ceil(height / rowEstimate) * 3))
        : MIN_PAGE_SIZE;
    if (newPageSize > pageSize) {
      setPageSize(newPageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, scrollTick, getScrollElement, rowEstimate, viewportRect]);

  // Persist scroll state (debounced).
  useEffect(() => {
    if (!isListContextCurrent || !onScrollStateChange) {
      return;
    }
    const timeoutId = setTimeout(() => {
      const el = scrollElRef.current;
      onScrollStateChange({
        anchor,
        // The logical committed offset: if a gesture is mid-flight with an owed
        // jump held in the first-row margin, fold it in so restore lands right.
        scrollTop: el
          ? scrollOffset(el) + anchorStateRef.current.pendingJump
          : 0,
        estimatedTotal: effectiveEstimatedTotal,
        hasReachedStart,
        hasReachedEnd,
        listContextParams,
      });
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [
    anchor,
    scrollTick,
    effectiveEstimatedTotal,
    hasReachedStart,
    hasReachedEnd,
    isListContextCurrent,
    onScrollStateChange,
    listContextParams,
    scrollOffset,
  ]);

  useEffect(() => {
    if (atStart) {
      setPaging(s => (s.hasReachedStart ? s : {...s, hasReachedStart: true}));
    }
  }, [atStart]);

  useEffect(() => {
    if (atEnd) {
      setPaging(s => (s.hasReachedEnd ? s : {...s, hasReachedEnd: true}));
    }
  }, [atEnd]);

  // The estimated total is a monotonic high-water mark of the discovered
  // extent: propose the current extent (exact when both ends are loaded) and
  // keep the max.
  useEffect(() => {
    if (!complete) {
      return;
    }
    const proposed = atStart && atEnd ? rowsLength : newEstimatedTotal;
    setPaging(s =>
      proposed > s.estimatedTotal ? {...s, estimatedTotal: proposed} : s,
    );
  }, [complete, atStart, atEnd, rowsLength, newEstimatedTotal]);

  // Keep the anchor index non-negative and collapse phantom space at the top.
  // Both branches relabel the virtual coordinate space, so the estimated total
  // moves by the same offset (atomically, via `setAnchor`).
  useEffect(() => {
    if (rowsEmpty || !isListContextCurrent) {
      return;
    }
    if (firstRowIndex < 0) {
      const placeholderRows = !atStart ? NUM_ROWS_FOR_LOADING_SKELETON : 0;
      const offset = -firstRowIndex + placeholderRows;
      setAnchor({...anchor, index: anchor.index + offset}, offset);
      return;
    }
    if (atStart && firstRowIndex > 0) {
      setAnchor(TOP_ANCHOR, -firstRowIndex);
    }
  }, [
    firstRowIndex,
    anchor,
    atStart,
    rowsEmpty,
    isListContextCurrent,
    setAnchor,
  ]);

  // Starts as null (not `effectiveScrollState`) so the effect below runs on
  // mount: the paging-state initializer restores the anchor/estimate from a
  // persisted state, but the scroll *offset* is DOM state it can't set, so on a
  // reload we must apply it here - otherwise the anchor is restored while
  // scrollTop stays 0, leaving the viewport parked on the blank top spacer.
  const appliedScrollStateRef = useRef<ScrollHistoryState<TStartRow> | null>(
    null,
  );

  useLayoutEffect(() => {
    const scrollStateChanged =
      effectiveScrollState !== appliedScrollStateRef.current;
    appliedScrollStateRef.current = effectiveScrollState;

    if (isListContextCurrent && !scrollStateChanged) {
      return;
    }

    // A list-context (sort/filter) change resets the list: drop the anchor and
    // suppress it until the new data loads, so we don't adopt or pin a stale
    // reference row from the outgoing list. Gated on the context change so a
    // same-context persistence refresh (which also runs this effect ~every 100ms
    // while scrolling) doesn't disturb the live anchor.
    if (!isListContextCurrent) {
      anchorKeyRef.current = null;
      anchorSuppressedRef.current = true;
    }

    if (effectiveScrollState) {
      // Re-base the anchor on a real restore (the write actually moves the
      // position), but not on a same-position persist refresh which must
      // leave the live anchor alone.
      if (setScrollTop(effectiveScrollState.scrollTop)) {
        anchorKeyRef.current = null;
      }
      setPaging(restoredPagingState(effectiveScrollState, listContextParams));
    } else if (permalinkID) {
      // Separate the two cases by visibility: clicking a row targets an already
      // *visible* row, so leave the scroll alone (it's just highlighted); a URL /
      // deep-link navigation targets an off-screen (or not-yet-loaded) row, so
      // re-anchor on it and scroll it to the top (in the effect below).
      const el = scrollElRef.current;
      const targetEl = el ? findRow(el, permalinkID) : null;
      let targetVisible = false;
      if (el && targetEl) {
        const vTop = adapter.viewportTop(el);
        targetVisible = rectInViewport(
          targetEl.getBoundingClientRect(),
          vTop,
          vTop + viewportRect(el).height,
        );
      }
      if (!targetVisible) {
        pendingPermalinkScrollRef.current = permalinkID;
        if (!targetEl) {
          // The row isn't loaded - re-anchor on it to load its page. (A loaded
          // but off-screen row is left in place and just scrolled to.)
          setPaging(permalinkPagingState(permalinkID, listContextParams));
        }
      }
    } else {
      anchorKeyRef.current = null;
      setScrollTop(0);
      setPaging({
        estimatedTotal: 0,
        hasReachedStart: true,
        hasReachedEnd: false,
        queryAnchor: {anchor: TOP_ANCHOR, listContextParams},
      });
    }
  }, [
    isListContextCurrent,
    effectiveScrollState,
    permalinkID,
    listContextParams,
    setScrollTop,
    adapter,
    viewportRect,
  ]);

  // When a URL / deep-link navigation targeted an off-screen permalink row (see
  // `pendingPermalinkScrollRef`), scroll it to the top once it has rendered. We
  // use `setScrollTop` (not `scrollIntoView`) so it sets `programmaticScrollRef`
  // and moves the offset off zero - both are needed to stop the paging effect
  // from re-anchoring to the top of the window while the target's context loads.
  // The row can move as rows stream in around it, so we retry on each change
  // until it reaches the top (or the scroll clamps because there's nothing more
  // to scroll into, e.g. the last row).
  useLayoutEffect(() => {
    const pending = pendingPermalinkScrollRef.current;
    if (pending === null) {
      return;
    }
    if (pending !== permalinkID) {
      // The permalink changed before we scrolled - drop the stale request.
      pendingPermalinkScrollRef.current = null;
      return;
    }
    const el = scrollElRef.current;
    if (!el) return;
    const target = findRow(el, pending);
    if (!target) {
      // Not rendered yet - keep the request open and retry once it loads, unless
      // the row genuinely doesn't exist.
      if (permalinkNotFound) {
        pendingPermalinkScrollRef.current = null;
      }
      return;
    }
    // Commit any held margin so the target's rect and our write are relative
    // to the real scroll offset, not a shifted layout.
    flushHold();
    const before = scrollOffset(el);
    const delta = target.getBoundingClientRect().top - adapter.viewportTop(el);
    if (Math.abs(delta) <= 1) {
      pendingPermalinkScrollRef.current = null; // reached the top
      return;
    }
    setScrollTop(before + delta);
    // The row keeps moving as its context streams in (it may briefly be the last
    // loaded row and clamp short of the top), so keep retrying until loading has
    // settled. At that point it's at its final position - at the top, or as high
    // as it can go when it's genuinely the last row - so stop.
    if (complete) {
      pendingPermalinkScrollRef.current = null;
    }
  }, [
    permalinkID,
    items,
    complete,
    permalinkNotFound,
    setScrollTop,
    adapter,
    scrollOffset,
    flushHold,
  ]);

  // ---- Paging: load more when the viewport nears the loaded window edges -----

  useEffect(() => {
    if (!isListContextCurrent || rowsEmpty || !complete) {
      return;
    }
    if (programmaticScrollRef.current) {
      return;
    }
    if (pendingPermalinkScrollRef.current !== null) {
      // A permalink jump is settling: don't re-anchor to the window edge while
      // the target's context is still loading and it's being scrolled to the top.
      return;
    }
    const el = scrollElRef.current;
    if (!el) return;

    // Which loaded rows are currently visible (by data-index)? Rows are in DOM
    // order, so once one starts below the viewport bottom the rest do too.
    const elTop = adapter.viewportTop(el);
    const elBottom = elTop + viewportRect(el).height;
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
    if (firstVisible === Infinity) {
      return;
    }

    if (atStart && firstRowIndex !== 0) {
      setAnchor(TOP_ANCHOR);
      return;
    }

    // Both distances are 0 when the corresponding edge row is visible.
    const threshold = Math.max(overscan, getNearPageEdgeThreshold(pageSize));
    const distanceFromStart = firstVisible - firstRowIndex;
    const distanceFromEnd = firstRowIndex + rowsLength - 1 - lastVisible;

    const updateAnchorForEdge = (
      targetIndex: number,
      type: 'forward' | 'backward',
      indexOffset: number,
    ) => {
      const index = toBoundIndex(targetIndex, firstRowIndex, rowsLength);
      const startRow = rowAt(index);
      assert(startRow !== undefined || type === 'forward');
      setAnchor({
        index: index + indexOffset,
        kind: type,
        startRow,
      } as Anchor<TStartRow>);
    };

    if (!atStart && distanceFromStart <= threshold) {
      updateAnchorForEdge(lastVisible + 2 * threshold, 'backward', 0);
      return;
    }
    if (!atEnd && distanceFromEnd <= threshold) {
      updateAnchorForEdge(firstVisible - 2 * threshold, 'forward', 1);
    }
  }, [
    isListContextCurrent,
    scrollTick,
    complete,
    pageSize,
    firstRowIndex,
    rowsLength,
    atStart,
    atEnd,
    rowsEmpty,
    rowAt,
    overscan,
    adapter,
    viewportRect,
    setAnchor,
  ]);

  const total =
    count ??
    (atStart && atEnd
      ? rowsLength
      : hasReachedStart && hasReachedEnd
        ? estimatedTotal
        : undefined);

  return {
    items,
    spaceBefore,
    spaceAfter,
    rowAt,
    complete,
    rowsEmpty: effectiveRowsEmpty,
    permalinkNotFound,
    estimatedTotal: effectiveEstimatedTotal,
    total,
    settled,
    debug: anchorStateRef,
  };
}

/**
 * Virtualized, infinitely-paginated list that scrolls inside an overflow
 * element. `getScrollElement` returns that element (which is also where the rows
 * are rendered).
 *
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export function useZeroVirtualizer<TListContextParams, TRow, TStartRow>(
  options: UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow>,
): ZeroVirtualizerResult<TRow> {
  return useZeroVirtualizerImpl(
    options,
    options.scrollAdapter ?? elementScrollAdapter,
  );
}

/**
 * Like {@linkcode useZeroVirtualizer}, but the list scrolls the window rather
 * than an overflow element. `getScrollElement` returns the element the rows are
 * rendered into (which lives in normal page flow); the window is the scroll
 * container.
 *
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export function useZeroWindowVirtualizer<TListContextParams, TRow, TStartRow>(
  options: UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow>,
): ZeroVirtualizerResult<TRow> {
  return useZeroVirtualizerImpl(
    options,
    options.scrollAdapter ?? windowScrollAdapter,
  );
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
