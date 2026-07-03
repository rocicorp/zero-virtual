import {useLayoutEffect, useReducer, useState} from 'react';
import {
  elementScrollAdapter,
  windowScrollAdapter,
  type ScrollAdapter,
  type ScrollRect,
} from '../core/scroll-adapter.ts';
import type {GetPageQuery, GetSingleQuery, RowKey} from '../core/types.ts';
import {
  ZeroVirtualizer,
  type VirtualizerOptions,
  type VirtualizerSnapshot,
} from '../core/virtualizer.ts';
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

/**
 * Options for configuring the Zero virtualizer. The core options (see
 * {@linkcode VirtualizerOptions}) plus the React-side wiring: the scroll
 * element getter, the query functions (bound via `@rocicorp/zero/react`), and
 * an optional custom scroll adapter.
 *
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination (typically a subset of TRow)
 */
export type UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow> =
  VirtualizerOptions<TListContextParams, TRow, TStartRow> & {
    /** Returns the scrollable container element. */
    getScrollElement: () => HTMLElement | null;

    /** Function that returns a query for fetching a page of rows */
    getPageQuery: GetPageQuery<TRow, TStartRow>;
    /** Function that returns a query for fetching a single row by ID */
    getSingleQuery: GetSingleQuery<TRow>;
    /** Function to extract the start row data from a full row (for pagination anchoring) */
    toStartRow: (row: TRow) => TStartRow;

    /**
     * How the scroll container is read and driven. Defaults to
     * {@linkcode elementScrollAdapter} for {@linkcode useZeroVirtualizer} and
     * {@linkcode windowScrollAdapter} for {@linkcode useZeroWindowVirtualizer}.
     * Provide a custom adapter to scroll some other container.
     */
    scrollAdapter?: ScrollAdapter | undefined;
  };

/**
 * Result object returned by the useZeroVirtualizer hook: the loaded rows to
 * render between two spacers, plus load/paging status. See
 * {@linkcode VirtualizerSnapshot} for field semantics. The object identity is
 * stable between renders whose content didn't change.
 *
 * @typeParam TRow - The type of row data returned from queries
 */
export type ZeroVirtualizerResult<TRow> = VirtualizerSnapshot<TRow>;

/**
 * Hook that creates a virtualized list with bidirectional pagination and state
 * persistence, backed by Zero's reactive queries.
 *
 * Thin React binding over the framework-agnostic {@linkcode ZeroVirtualizer}:
 * options and query results are pushed into the core every render (silent
 * staging), DOM work runs from layout effects (pre-paint), and re-renders are
 * driven by the core's change notifications.
 */
function useZeroVirtualizerImpl<TListContextParams, TRow, TStartRow>(
  options: UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow>,
  adapter: ScrollAdapter,
): ZeroVirtualizerResult<TRow> {
  const [, rerender] = useReducer(() => ({}), {});
  // One core instance per hook lifetime. The constructor is pure (no DOM /
  // listeners / timers), so Strict Mode's double construction is harmless —
  // and initializing paging from the persisted scroll state here avoids
  // Strict Mode double-mounting the rows.
  const [core] = useState(
    () =>
      new ZeroVirtualizer<TListContextParams, TRow, TStartRow>(
        options,
        adapter,
      ),
  );

  // Silent staging — never notifies during render.
  core.setOptions(options);
  const {pageSize, anchor, settled} = core.getQueryInputs();
  core.setRows(
    useRows({
      pageSize,
      anchor,
      settled,
      getPageQuery: options.getPageQuery,
      getSingleQuery: options.getSingleQuery,
      toStartRow: options.toStartRow,
    }),
  );

  // Mount/unmount: re-render subscription + listener teardown. Idempotent
  // across Strict Mode's mount→unmount→mount (state survives detach; the
  // per-commit effect below re-attaches).
  useLayoutEffect(() => {
    const unsubscribe = core.subscribe(rerender);
    return () => {
      unsubscribe();
      core.detach();
    };
  }, [core]);

  // Every commit, before paint: (re)wire the scroll element and run the
  // core's post-DOM-update pass (anchoring compensation, restore/permalink,
  // paging, persistence).
  useLayoutEffect(() => {
    core.attach(options.getScrollElement());
    core.afterDOMUpdate();
  });

  return core.getSnapshot();
}

/**
 * Virtualized, infinitely-paginated list that scrolls inside an overflow
 * element. `getScrollElement` returns that element (which is also where the
 * rows are rendered).
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
 * than an overflow element. `getScrollElement` returns the element the rows
 * are rendered into (which lives in normal page flow); the window is the
 * scroll container.
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

// Referenced by docs above; re-exported for wrapper implementors.
export type {VirtualizerOptions, VirtualizerSnapshot};
export type {GetPageQuery, GetSingleQuery, RowKey};
