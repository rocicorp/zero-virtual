import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type Key,
} from 'react';
import {pagingReducer, type PagingState} from './paging-reducer.ts';
import {
  useRows,
  type Anchor,
  type GetPageQuery,
  type GetSingleQuery,
} from './use-rows.ts';

// Make sure this is even since we half it for scroll state loading
const MIN_PAGE_SIZE = 100;

const NUM_ROWS_FOR_LOADING_SKELETON = 1;

const DEBUG_LOG_PREFIX = '[useZeroVirtualizer]';

function debugLog(message: string, payload?: unknown) {
  if (payload === undefined) {
    console.log(DEBUG_LOG_PREFIX, message);
    return;
  }
  console.log(DEBUG_LOG_PREFIX, message, payload);
}

/**
 * State object that captures the virtualizer's scroll position and pagination state.
 * Used for persisting and restoring the virtualizer state across navigation or page reloads.
 *
 * @typeParam TStartRow - The type of the start row data used for pagination anchoring
 */
export type ScrollHistoryState<
  TStartRow,
  TListContextParams = unknown,
> = Readonly<{
  /** The anchor point for pagination (includes position, direction, and start row data) */
  anchor: Anchor<TStartRow>;
  /** The scroll position in pixels from the top of the scrollable container */
  scrollTop: number;
  /** The estimated total number of rows in the list */
  estimatedTotal: number;
  /** Whether the virtualizer has reached the start of the list */
  hasReachedStart: boolean;
  /** Whether the virtualizer has reached the end of the list */
  hasReachedEnd: boolean;
  /** The list context params active when this state was saved (used to invalidate stale state) */
  listContextParams: TListContextParams;
}>;

const TOP_ANCHOR = Object.freeze({
  index: 0,
  kind: 'forward',
  startRow: undefined,
}) satisfies Anchor<unknown>;

// Placeholder for useRows' required getSingleQuery param.
// Permalink anchors are not created by useZeroVirtualizer so this is never called.
const noopGetSingleQuery: GetSingleQuery<unknown> = () => ({
  query: null as never,
});

/**
 * Options for the Tanstack React Virtualizer.
 *
 * @typeParam TScrollElement - The type of the scrollable container element
 * @typeParam TItemElement - The type of the individual item elements
 */
export type TanstackUseVirtualizerOptions<
  TScrollElement extends Element,
  _TItemElement extends Element = Element,
> = {
  count?: number;
  initialOffset?: number;
  horizontal?: boolean;
  estimateSize?: ((index: number) => number) | undefined;
  overscan?: number;
  getScrollElement: () => TScrollElement | null;
};

/**
 * Options for configuring the Zero virtualizer.
 * Extends Tanstack Virtual's options with Zero-specific pagination and state management.
 *
 * @typeParam TScrollElement - The type of the scrollable container element
 * @typeParam TItemElement - The type of the individual item elements
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination (typically a subset of TRow)
 */
export type UseZeroVirtualizerOptions<
  TScrollElement extends Element,
  TItemElement extends Element,
  TListContextParams,
  TRow,
  TStartRow,
> = Omit<
  TanstackUseVirtualizerOptions<TScrollElement, TItemElement>,
  // count is managed by useZeroVirtualizer
  | 'count'
  // initialOffset is managed by useZeroVirtualizer
  | 'initialOffset'
  // Only support vertical lists for now
  | 'horizontal'
> & {
  /** Parameters that define the list's query context (filters, sort order, etc.) */
  listContextParams: TListContextParams;

  /** Function that returns a query for fetching a page of rows */
  getPageQuery: GetPageQuery<TRow, TStartRow>;
  /**
   * Time in ms the list must remain unscrolled before it is considered "settled".
   * When settled, query functions receive `{settled: true}` so they can return
   * different options (e.g., longer TTL). Defaults to 2000.
   */
  settleTime?: number | undefined;
  /** Function to extract the start row data from a full row (for pagination anchoring) */
  toStartRow: (row: TRow) => TStartRow;

  /**
   * Function to extract a unique key from a row, used for stable item identification.
   * Required for browser scroll anchoring to work correctly during paging.
   */
  getRowKey: (row: TRow) => Key;

  /**
   * Optional current scroll state (accepted but currently ignored — kept for API compatibility).
   */
  scrollState?: ScrollHistoryState<TStartRow> | null | undefined;
  /**
   * Optional callback for scroll state changes (accepted but currently ignored — kept for API compatibility).
   */
  onScrollStateChange?:
    | ((state: ScrollHistoryState<TStartRow>) => void)
    | undefined;

  /**
   * Optional callback invoked when the list becomes settled (no scroll
   * activity for `settleTime` ms). Useful for syncing deferred state
   * like URL query parameters.
   */
  onSettled?: (() => void) | undefined;
};

/**
 * Result object returned by the useZeroVirtualizer hook.
 *
 * @typeParam TScrollElement - The type of the scrollable container element
 * @typeParam TItemElement - The type of the individual item elements
 * @typeParam TRow - The type of row data returned from queries
 */
export type ZeroVirtualizerResult<
  // TScrollElement extends Element,
  // TItemElement extends Element,
  TRow,
> = {
  // /** The Tanstack Virtual virtualizer instance for rendering virtual items */
  // virtualizer: Virtualizer<TScrollElement, TItemElement>;
  // /** Function to get the row data at a specific index, or undefined if not loaded */
  // rowAt: (index: number) => TRow | undefined;
  /** Whether all initially requested data has finished loading */
  complete: boolean;
  /** Whether the list is empty (no rows exist matching the query) */
  rowsEmpty: boolean;
  /** Estimated total number of rows (may be inexact until both ends are reached) */
  estimatedTotal: number;
  virtualRows: TRow[];

  atStart: boolean;
  atEnd: boolean;

  total: number | undefined;

  /** Spacer height before the loaded rows (in px) */
  startPlaceholderHeight: number;
  /** Spacer height after the loaded rows (in px) */
  endPlaceholderHeight: number;

  /** Callback ref to attach to the sentinel element at the start of the list */
  startRef: (node: Element | null) => void;
  /** Callback ref to attach to the sentinel element at the end of the list */
  endRef: (node: Element | null) => void;
};

/**
 * Hook that creates a virtualized list with bidirectional pagination.
 *
 * This hook combines Tanstack Virtual's efficient virtualization with Zero's reactive queries
 * to create infinitely scrolling lists that load data on demand. It supports:
 * - Bidirectional scrolling (load more items at top or bottom)
 * - Dynamic page sizing based on viewport
 * - Browser scroll anchoring (items are keyed via getRowKey so DOM nodes persist during paging)
 *
 * @typeParam TScrollElement - The type of the scrollable container element
 * @typeParam TItemElement - The type of the individual item elements
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 *
 * @param options - Configuration options including query functions, sizing, and state management
 * @returns An object containing the virtualizer instance, row accessor, and state flags
 *
 * @example
 * ```tsx
 * const {virtualizer, rowAt, complete} = useZeroVirtualizer({
 *   estimateSize: () => 50,
 *   getScrollElement: () => scrollRef.current,
 *   listContextParams: {projectId: 'abc'},
 *   getPageQuery: ({limit, start, dir}) => ({query: z.query.issues.where(...).limit(limit)}),
 *   toStartRow: (row) => ({id: row.id, created: row.created}),
 *   getRowKey: (row) => row.id,
 * });
 * ```
 */
export function useZeroVirtualizer<
  TScrollElement extends Element,
  TItemElement extends Element,
  TListContextParams,
  TRow,
  TStartRow,
>({
  // Tanstack Virtual params
  overscan = 5, // Virtualizer defaults to 1.
  getScrollElement,

  // Zero specific params
  listContextParams,
  getPageQuery,
  settleTime = 2000,
  toStartRow,
  getRowKey,

  onSettled: _onSettled,

  // Accepted but ignored (no-op) — kept for API compatibility
  scrollState: _scrollState,
  onScrollStateChange: _onScrollStateChange,

  ...restVirtualizerOptions
}: UseZeroVirtualizerOptions<
  TScrollElement,
  TItemElement,
  TListContextParams,
  TRow,
  TStartRow
>): ZeroVirtualizerResult<// TScrollElement,
//  TItemElement,
TRow> {
  void restVirtualizerOptions;
  const startNodeRef = useRef<Element | null>(null);
  const endNodeRef = useRef<Element | null>(null);

  // DOM-based placeholder heights – set right before each page swap
  // by reading the scroll container's geometry.
  const [startPlaceholderHeight, setStartPlaceholderHeight] = useState(0);
  const [endPlaceholderHeight, setEndPlaceholderHeight] = useState(0);

  // Initialize paging state
  const [
    {
      estimatedTotal,
      // hasReachedStart,
      // hasReachedEnd,
      queryAnchor,
    },
    dispatch,
  ] = useReducer(
    pagingReducer<TListContextParams, TStartRow>,
    undefined,
    (): PagingState<TListContextParams, TStartRow> => ({
      estimatedTotal: NUM_ROWS_FOR_LOADING_SKELETON,
      hasReachedStart: false,
      hasReachedEnd: false,
      queryAnchor: {
        anchor: TOP_ANCHOR,
        listContextParams,
      },
    }),
  );

  const isListContextCurrent =
    queryAnchor.listContextParams === listContextParams;

  const anchor = useMemo(() => {
    if (isListContextCurrent) {
      return queryAnchor.anchor;
    }
    return TOP_ANCHOR;
  }, [isListContextCurrent, queryAnchor.anchor]);

  const [pageSize, _setPageSize] = useState(MIN_PAGE_SIZE);

  const rawRows = useRows({
    pageSize,
    anchor,
    // TODO: add back settled
    settled: false,
    getPageQuery,
    getSingleQuery: noopGetSingleQuery as GetSingleQuery<TRow>,
    toStartRow,
  });

  // Buffer useRows results: keep serving the previous complete snapshot
  // until the new query is complete. This prevents intermediate states
  // (empty/partial data) from reaching the virtualizer, which would cause
  // DOM nodes to disappear and break browser scroll anchoring.
  const bufferedRowsRef = useRef(rawRows);
  if (rawRows.complete) {
    bufferedRowsRef.current = rawRows;
  }
  const {
    rowAt,
    rowsLength,
    complete,
    rowsEmpty,
    atStart,
    atEnd,
    firstRowIndex,
  } = bufferedRowsRef.current;

  const newEstimatedTotal = firstRowIndex + rowsLength;

  const {scrollTop, scrollHeight, clientHeight} =
    useScrollMeasurements(getScrollElement());

  useEffect(() => {
    debugLog('scroll', {scrollTop, scrollHeight, clientHeight});
  }, [scrollTop, scrollHeight, clientHeight]);

  debugLog('render', {clientHeight, scrollHeight});

  // useEffect(() => {
  //   // Make sure page size is enough to fill the scroll element at least
  //   // 3 times.  Don't shrink page size.
  //   const newPageSize = clientHeight
  //     ? Math.max(
  //         MIN_PAGE_SIZE,
  //         makeEven(Math.ceil(clientHeight / estimateSize(0)) * 3),
  //       )
  //     : MIN_PAGE_SIZE;
  //   if (newPageSize > pageSize) {
  //     setPageSize(newPageSize);
  //   }
  // }, [pageSize, clientHeight]);

  useEffect(() => {
    if (complete) {
      if (atStart && atEnd) {
        dispatch({type: 'UPDATE_ESTIMATED_TOTAL', newTotal: rowsLength});
      } else if (newEstimatedTotal > estimatedTotal) {
        dispatch({type: 'UPDATE_ESTIMATED_TOTAL', newTotal: newEstimatedTotal});
      }
    }
  }, [estimatedTotal, complete, atStart, atEnd, newEstimatedTotal]);

  // Reset placeholder heights when we've confirmed we reached an edge.
  useEffect(() => {
    if (complete && atStart) {
      setStartPlaceholderHeight(0);
    }
  }, [complete, atStart]);

  useEffect(() => {
    if (complete && atEnd) {
      setEndPlaceholderHeight(0);
    }
  }, [complete, atEnd]);

  useEffect(() => {
    if (rowsEmpty || !isListContextCurrent) {
      return;
    }

    if (atStart && firstRowIndex > 0) {
      dispatch({type: 'RESET_TO_TOP', offset: -firstRowIndex});
      return;
    }
  }, [firstRowIndex, anchor, atStart, rowsEmpty, isListContextCurrent]);

  // Reset state when listContextParams change.
  useEffect(() => {
    if (!isListContextCurrent) {
      dispatch({
        type: 'RESET_STATE',
        estimatedTotal: 0,
        hasReachedStart: true,
        hasReachedEnd: false,
        anchor: TOP_ANCHOR,
        listContextParams,
      });
    }
  }, [isListContextCurrent, listContextParams]);

  useEffect(() => {
    const scrollElement = getScrollElement();
    const startNode = startNodeRef.current;
    const endNode = endNodeRef.current;

    if (
      !scrollElement ||
      (!startNode && !endNode) ||
      !isListContextCurrent ||
      rowsEmpty ||
      rowsLength === 0 ||
      !rawRows.complete ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const preloadMarginPx = Math.max(
      0,
      Math.floor(scrollElement.clientHeight / 2),
    );
    const rootMargin = `${preloadMarginPx}px 0px ${preloadMarginPx}px 0px`;

    debugLog('observer setup', {
      rootMargin,
      pageSize,
      firstRowIndex,
      rowsLength,
      atStart,
      atEnd,
    });

    const stepSize = Math.max(1, getNearPageEdgeThreshold(pageSize));

    const moveAnchorBackward = () => {
      if (atStart) {
        return;
      }

      const shift = Math.min(stepSize, firstRowIndex);
      const targetIndex = firstRowIndex + rowsLength - 1 - shift;
      const startRow = rowAt(targetIndex);
      if (startRow === undefined) {
        return;
      }

      const nextAnchor = {
        index: targetIndex,
        kind: 'backward',
        startRow: toStartRow(startRow),
      } satisfies Anchor<TStartRow>;

      if (
        anchor.kind === nextAnchor.kind &&
        anchor.index === nextAnchor.index
      ) {
        return;
      }

      // Measure the anchor row's bottom in scroll-content coordinates.
      // Everything below it becomes the end placeholder.
      if (startNode) {
        const rowOffset = targetIndex - firstRowIndex;
        const anchorEl = getRowElementAt(startNode, rowOffset);
        if (anchorEl) {
          const anchorBottom = getElementContentBottom(anchorEl, scrollElement);
          const newEnd = Math.max(0, scrollElement.scrollHeight - anchorBottom);
          setEndPlaceholderHeight(newEnd);
          debugLog('paging backward', {
            fromAnchor: anchor,
            toAnchor: nextAnchor,
            endPlaceholderHeight: newEnd,
          });
        }
      }
      dispatch({type: 'UPDATE_ANCHOR', anchor: nextAnchor});
    };

    const moveAnchorForward = () => {
      if (atEnd) {
        return;
      }

      const shift = Math.min(stepSize, rowsLength - 1);
      const targetIndex = firstRowIndex + shift;
      const startRow = rowAt(targetIndex);
      if (startRow === undefined) {
        return;
      }

      const nextAnchor = {
        index: targetIndex + 1,
        kind: 'forward',
        startRow: toStartRow(startRow),
      } satisfies Anchor<TStartRow>;

      if (
        anchor.kind === nextAnchor.kind &&
        anchor.index === nextAnchor.index
      ) {
        return;
      }

      // Measure the anchor row's bottom in scroll-content coordinates.
      // Everything above it becomes the start placeholder.
      if (startNode) {
        const anchorEl = getRowElementAt(startNode, shift);
        if (anchorEl) {
          const anchorBottom = getElementContentBottom(anchorEl, scrollElement);
          setStartPlaceholderHeight(Math.max(0, anchorBottom));
          debugLog('paging forward', {
            fromAnchor: anchor,
            toAnchor: nextAnchor,
            startPlaceholderHeight: anchorBottom,
          });
        }
      }
      dispatch({type: 'UPDATE_ANCHOR', anchor: nextAnchor});
    };

    const observer = new IntersectionObserver(
      entries => {
        let startVisible = false;
        let endVisible = false;

        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          if (startNode && entry.target === startNode) {
            startVisible = true;
          }

          if (endNode && entry.target === endNode) {
            endVisible = true;
          }
        }

        if (startVisible || endVisible) {
          debugLog('sentinel intersected', {
            startVisible,
            endVisible,
          });
        }

        if (startVisible) {
          moveAnchorBackward();
          return;
        }

        if (endVisible) {
          moveAnchorForward();
        }
      },
      {
        root: scrollElement,
        rootMargin,
        threshold: 0,
      },
    );

    if (startNode) {
      observer.observe(startNode);
    }

    if (endNode) {
      observer.observe(endNode);
    }

    return () => {
      debugLog('observer cleanup');
      observer.disconnect();
    };
  }, [
    getScrollElement,
    isListContextCurrent,
    rowsEmpty,
    rowsLength,
    rawRows.complete,
    firstRowIndex,
    atStart,
    atEnd,
    pageSize,
    rowAt,
    toStartRow,
    anchor,
  ]);

  // const virtualItems = virtualizer.getVirtualItems();

  const virtualRows: TRow[] = [];
  for (let i = firstRowIndex; i < firstRowIndex + rowsLength; i++) {
    virtualRows.push(rowAt(i) as TRow);
  }

  // useEffect(() => {
  //   if (!isListContextCurrent || rowsEmpty || !complete) {
  //     return;
  //   }

  //   if (atStart) {
  //     if (firstRowIndex !== 0) {
  //       dispatch({type: 'UPDATE_ANCHOR', anchor: TOP_ANCHOR});
  //       return;
  //     }
  //   }

  //   const updateAnchorForEdge = (
  //     targetIndex: number,
  //     type: 'forward' | 'backward',
  //     indexOffset: number,
  //   ) => {
  //     const index = toBoundIndex(targetIndex, firstRowIndex, rowsLength);
  //     const row = rowAt(index);
  //     assert(row !== undefined || type === 'forward');
  //     dispatch({
  //       type: 'UPDATE_ANCHOR',
  //       anchor: {
  //         index: index + indexOffset,
  //         kind: type,
  //         startRow: row ? toStartRow(row) : undefined,
  //       } as Anchor<TStartRow>,
  //     });
  //   };

  //   const firstItem = rows[0];
  //   const lastItem = rows[rows.length - 1];
  //   const nearPageEdgeThreshold = getNearPageEdgeThreshold(pageSize);

  //   const distanceFromStart = firstItem.index - firstRowIndex;
  //   const distanceFromEnd = firstRowIndex + rowsLength - lastItem.index;

  //   if (!atStart && distanceFromStart <= nearPageEdgeThreshold) {
  //     updateAnchorForEdge(
  //       lastItem.index + 2 * nearPageEdgeThreshold,
  //       'backward',
  //       0,
  //     );
  //     return;
  //   }

  //   if (!atEnd && distanceFromEnd <= nearPageEdgeThreshold) {
  //     updateAnchorForEdge(
  //       firstItem.index - 2 * nearPageEdgeThreshold,
  //       'forward',
  //       1,
  //     );
  //     return;
  //   }
  // }, [
  //   isListContextCurrent,
  //   rows,
  //   complete,
  //   pageSize,
  //   firstRowIndex,
  //   rowsLength,
  //   atStart,
  //   atEnd,
  //   rowAt,
  //   toStartRow,
  // ]);

  const startRef = useCallback((node: Element | null) => {
    startNodeRef.current = node;
    debugLog('startRef updated', {attached: node !== null});
  }, []);

  const endRef = useCallback((node: Element | null) => {
    endNodeRef.current = node;
    debugLog('endRef updated', {attached: node !== null});
  }, []);

  return {
    virtualRows,
    complete,
    rowsEmpty,
    estimatedTotal,
    total: undefined,
    atStart,
    atEnd,
    startPlaceholderHeight,
    endPlaceholderHeight,
    startRef,
    endRef,
  };
}

// /**
//  * Clamps an index to be within the valid range of rows.
//  * @param targetIndex - The desired index to clamp
//  * @param firstRowIndex - The first valid row index
//  * @param rowsLength - The number of rows available
//  * @returns The clamped index within [firstRowIndex, firstRowIndex + rowsLength - 1]
//  */
// function toBoundIndex(
//   targetIndex: number,
//   firstRowIndex: number,
//   rowsLength: number,
// ): number {
//   if (rowsLength === 0) {
//     return firstRowIndex;
//   }
//   return Math.max(
//     firstRowIndex,
//     Math.min(firstRowIndex + rowsLength - 1, targetIndex),
//   );
// }

/**
 * Calculates the threshold for when to trigger loading more rows based on the page size.
 * @param pageSize - The current page size
 * @returns The threshold number of rows
 */
function getNearPageEdgeThreshold(pageSize: number) {
  return Math.ceil(pageSize / 10);
}

// function makeEven(n: number) {
//   return n % 2 === 0 ? n : n + 1;
// }

/**
 * Returns the row element at the given offset (0-based) after the sentinel.
 * Row 0 is the first `nextElementSibling` of the sentinel.
 */
function getRowElementAt(sentinel: Element, offset: number): Element | null {
  let el: Element | null = sentinel.nextElementSibling;
  for (let i = 0; i < offset && el; i++) {
    el = el.nextElementSibling;
  }
  return el;
}

/**
 * Returns the bottom edge of `element` in scroll-content coordinates
 * (i.e. pixels from the top of the scroll content, not from the viewport).
 */
function getElementContentBottom(
  element: Element,
  scrollContainer: Element,
): number {
  const scrollRect = scrollContainer.getBoundingClientRect();
  const elRect = element.getBoundingClientRect();
  return elRect.bottom - scrollRect.top + scrollContainer.scrollTop;
}

function useScrollMeasurements<TScrollElement extends Element>(
  scrollElement: TScrollElement | null,
): {scrollTop: number; scrollHeight: number; clientHeight: number} {
  const {scrollTop, scrollHeight, clientHeight} = useSyncExternalStore(
    onStoreChange => {
      if (!scrollElement) {
        return () => {};
      }
      scrollElement.addEventListener('scroll', onStoreChange);
      const resizeObserver = new ResizeObserver(onStoreChange);
      resizeObserver.observe(scrollElement);
      return () => {
        scrollElement.removeEventListener('scroll', onStoreChange);
        resizeObserver.disconnect();
      };
    },
    () => scrollElement ?? emptyScrollMeasurements,
    () => emptyScrollMeasurements,
  );

  return useMemo(
    () =>
      !scrollElement
        ? emptyScrollMeasurements
        : {
            scrollTop,
            scrollHeight,
            clientHeight,
          },
    [scrollElement, scrollTop, scrollHeight, clientHeight],
  );
}

const emptyScrollMeasurements = {
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
};

// function useCompleteRows(...args: Parameters<typeof useRows>) {
//   const completeRef = useRef<ReturnType<typeof useRows> | null>(null);
//   const x = useRows(...args);
//   if (x.complete) {
//     completeRef.current = x;
//   }
//   return completeRef.current ?? x;
// }
