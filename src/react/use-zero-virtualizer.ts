import {useLayoutEffect, useMemo, useReducer, useState} from 'react';
import {
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  resolveElementScrollElement,
  resolveWindowScrollElement,
  type ResolvedScrollOptions,
  type ResolveScrollElement,
} from '../core/scroll.ts';
import {
  virtualizerResult,
  ZeroVirtualizer,
  type VirtualizerResult,
} from '../core/virtualizer.ts';
import type {VirtualizerBindingOptions} from '../zero-types.ts';
import {useRows} from './use-rows.ts';

/**
 * Options for configuring the Zero virtualizer. The core options (see
 * {@linkcode VirtualizerBindingOptions}) plus the React-side wiring: the
 * scroll element getter, the query functions (bound via
 * `@rocicorp/zero/react`), and optional overrides of the scroll observers
 * (TanStack Virtual style).
 *
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination (typically a subset of TRow)
 */
export type UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow> =
  VirtualizerBindingOptions<TListContextParams, TRow, TStartRow>;

/**
 * Result object returned by the useZeroVirtualizer hook: the loaded rows to
 * render inside a content wrapper, with `spaceBefore` / `spaceAfter` standing
 * in for the unloaded rows above and below — rendered as spacer elements (see
 * {@linkcode VirtualizerResult}),
 * plus load/paging status, the resolved scroll
 * wiring (`options`), and the current scrolling element (`scrollElement`).
 * See {@linkcode VirtualizerResult} for field semantics. The object identity
 * is stable between renders whose content didn't change.
 *
 * @typeParam TRow - The type of row data returned from queries
 */
export type ZeroVirtualizerResult<TRow> = VirtualizerResult<TRow>;

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
  // The binding options with the observers already defaulted (the hooks
  // below spread them in, TanStack style).
  options: UseZeroVirtualizerOptions<TListContextParams, TRow, TStartRow> &
    ResolvedScrollOptions,
  resolveScrollElement: ResolveScrollElement,
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
        resolveScrollElement,
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

  const {getScrollElement, observeElementRect, observeElementOffset} = options;
  const resultOptions = useMemo(
    () => ({getScrollElement, observeElementRect, observeElementOffset}),
    [getScrollElement, observeElementRect, observeElementOffset],
  );
  const snapshot = core.getSnapshot();
  return useMemo(
    () => virtualizerResult(snapshot, resultOptions, resolveScrollElement),
    [snapshot, resultOptions, resolveScrollElement],
  );
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
    {
      ...options,
      observeElementRect: options.observeElementRect ?? observeElementRect,
      observeElementOffset:
        options.observeElementOffset ?? observeElementOffset,
    },
    resolveElementScrollElement,
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
    {
      ...options,
      observeElementRect: options.observeElementRect ?? observeWindowRect,
      observeElementOffset: options.observeElementOffset ?? observeWindowOffset,
    },
    resolveWindowScrollElement,
  );
}
