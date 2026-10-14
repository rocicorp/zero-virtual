/**
 * Framework- and library-agnostic core of `@rocicorp/zero-virtual`. Nothing
 * here depends on `@rocicorp/zero`: the query types are opaque generics, so
 * wrappers can bind the core to any fetching library.
 *
 * It exports what a framework binding is built from — what the `./react`
 * and `./solid` ones use — and nothing of the core's internals.
 *
 * @experimental This entry point is public but UNSTABLE: it exists so
 * framework wrappers (react, solid, yours) can share one implementation, and
 * its API may change in breaking ways in any release while it settles. The
 * `./react` and `./solid` entry points are the stable surfaces.
 */
export {laneAttributes, rowAttributes} from './dom.ts';
export {
  getHistoryNavigationSnapshot,
  subscribeHistoryState,
  writeHistoryState,
} from './history-state.ts';
export {
  assembleRows,
  buildPageQueries,
  buildSingleQuery,
  type RowsQueryInputs,
  type RowsQueryResults,
  type RowsSnapshot,
} from './rows.ts';
export {
  createStickToBottomCache,
  DEFAULT_STICK_SLACK,
  type StickOptions,
  type StickToBottomCache,
} from './stick-to-bottom.ts';
export type {Layout, LayoutFactory, LayoutHost} from './layout.ts';
export {masonryLayout, type MasonryState} from './masonry.ts';
export {
  virtualizerResult,
  ZeroVirtualizer,
  type VirtualizerBindingOptions,
  type VirtualizerOptions,
  type VirtualizerResult,
  type VirtualizerSnapshot,
} from './virtualizer.ts';
export {
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  resolveElementScrollElement,
  resolveWindowScrollElement,
  type ObserveElementOffset,
  type ObserveElementRect,
  type ResolvedScrollOptions,
  type ResolveScrollElement,
  type ScrollObserverInstance,
  type ScrollRect,
  type VirtualizerScrollOptions,
} from './scroll.ts';
export type {
  Anchor,
  AnchoringMode,
  GetPageQuery,
  GetPageQueryOptions,
  GetSingleQuery,
  GetSingleQueryOptions,
  QueryResult,
  RowKey,
  ScrollAlignment,
  ScrollHistoryState,
  ScrollToItemOptions,
  VirtualRow,
} from './types.ts';
