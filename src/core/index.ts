/**
 * Framework- and library-agnostic core of `@rocicorp/zero-virtual`. Nothing
 * here depends on `@rocicorp/zero`: the query types are opaque generics, so
 * wrappers can bind the core to any fetching library.
 *
 * @experimental This entry point is public but UNSTABLE: it exists so
 * framework wrappers (react, solid, yours) can share one implementation, and
 * its API may change in breaking ways in any release while it settles. The
 * `./react` and `./solid` entry points are the stable surfaces.
 */
export {
  contentWrapper,
  findRow,
  firstRow,
  queryRows,
  rowAttributes,
  VROW_INDEX_ATTR,
  VROW_KEY_ATTR,
} from './dom.ts';
export {
  getHistoryStateServerSnapshot,
  getHistoryStateSnapshot,
  subscribeHistoryState,
  updateHistoryState,
} from './history-state.ts';
export {
  assembleRows,
  buildAfterQuery,
  buildMainQuery,
  buildSingleQuery,
  permalinkMissing,
  type RowsQueryInputs,
  type RowsQueryResults,
  type RowsSnapshot,
} from './rows.ts';
export {
  createStickToBottom,
  createStickToBottomCache,
  DEFAULT_STICK_SLACK,
  type StickOptions,
  type StickToBottomCache,
  type StickToBottomController,
} from './stick-to-bottom.ts';
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
  ScrollHistoryState,
  VirtualRow,
} from './types.ts';
