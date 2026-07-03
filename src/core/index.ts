/**
 * Framework-agnostic core of `@rocicorp/zero-virtual`.
 *
 * @experimental This entry point is public but UNSTABLE: it exists so
 * framework wrappers (react, solid, yours) can share one implementation, and
 * its API may change in breaking ways in any release while it settles. The
 * `./react` and `./solid` entry points are the stable surfaces.
 */
export {
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
  DEFAULT_STICK_SLACK,
  type StickToBottomController,
} from './stick-to-bottom.ts';
export {
  ZeroVirtualizer,
  type VirtualizerOptions,
  type VirtualizerSnapshot,
} from './virtualizer.ts';
export {
  elementScrollAdapter,
  windowScrollAdapter,
  type ScrollAdapter,
  type ScrollRect,
} from './scroll-adapter.ts';
export type {
  Anchor,
  AnchoringMode,
  GetPageQuery,
  GetPageQueryOptions,
  GetQueryReturnType,
  GetSingleQuery,
  GetSingleQueryOptions,
  QueryOptions,
  QueryResult,
  RowKey,
  ScrollHistoryState,
  TTL,
  VirtualRow,
} from './types.ts';
