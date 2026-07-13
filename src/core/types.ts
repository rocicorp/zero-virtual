/**
 * Stable per-row key (row id when loaded, index-derived otherwise). Kept
 * framework-free — assignable to React's `Key` and usable directly in Solid.
 */
export type RowKey = string | number;

/**
 * Represents a position in the virtualized list used for pagination.
 *
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export type Anchor<TStartRow> =
  | Readonly<{
      index: number;
      kind: 'forward';
      startRow?: TStartRow | undefined;
    }>
  | Readonly<{
      index: number;
      kind: 'backward';
      startRow: TStartRow;
    }>
  | Readonly<{
      index: number;
      kind: 'permalink';
      id: string;
    }>;

/**
 * Result returned by query functions: a query plus optional per-query options.
 *
 * The query is opaque to the core — `TQuery` is whatever query/request type
 * the consumer's fetching library uses. The `./react` and `./solid` entry
 * points instantiate it with a Zero query (see `zero-types.ts`); a custom
 * wrapper can use any other library's type.
 *
 * @typeParam TQuery - The query type consumed by the wrapper's data layer
 */
export type QueryResult<TQuery, TOptions> = {
  query: TQuery;
  options?: TOptions;
};

/**
 * Options passed to {@link GetPageQuery}.
 *
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export type GetPageQueryOptions<TStartRow> = {
  /** The maximum number of rows to return */
  limit: number;
  /** The start row data to anchor the query, or null if starting from the beginning */
  start: TStartRow | null;
  /** The direction to paginate ('forward' or 'backward') */
  dir: 'forward' | 'backward';
  /** Whether the list has been idle for `settleTime` ms */
  settled: boolean;
};

/**
 * Function that returns a query for fetching a page of rows.
 *
 * @typeParam TQuery - The query type consumed by the wrapper's data layer
 *   (opaque to the core; see {@link QueryResult})
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export type GetPageQuery<TQuery, TOptions, TStartRow> = (
  options: GetPageQueryOptions<TStartRow>,
) => QueryResult<TQuery, TOptions>;

/**
 * Options passed to {@link GetSingleQuery}.
 */
export type GetSingleQueryOptions = {
  /** The ID of the row to fetch */
  id: string;
  /** Whether the list has been idle for `settleTime` ms */
  settled: boolean;
};

/**
 * Function that returns a query for fetching a single row by ID.
 *
 * @typeParam TQuery - The query type consumed by the wrapper's data layer
 *   (opaque to the core; see {@link QueryResult})
 */
export type GetSingleQuery<TQuery, TOptions> = (
  options: GetSingleQueryOptions,
) => QueryResult<TQuery, TOptions>;

/**
 * The query wiring the framework bindings add on top of the core options.
 * The query types are opaque here — the `./react` and `./solid` entry points
 * instantiate them with Zero queries (bound via `@rocicorp/zero/react` or
 * `@rocicorp/zero/solid`); a custom wrapper can use any other library's
 * query type.
 *
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 * @typeParam TPageQuery - The query type returned by `getPageQuery`
 * @typeParam TSingleQuery - The query type returned by `getSingleQuery`
 */
export type VirtualizerQueryOptions<
  TRow,
  TStartRow,
  TPageQuery,
  TPageOptions,
  TSingleQuery,
  TSingleOptions,
> = {
  /** Function that returns a query for fetching a page of rows */
  getPageQuery: GetPageQuery<TPageQuery, TPageOptions, TStartRow>;
  /** Function that returns a query for fetching a single row by ID */
  getSingleQuery: GetSingleQuery<TSingleQuery, TSingleOptions>;
  /** Function to extract the start row data from a full row (for pagination anchoring) */
  toStartRow: (row: TRow) => TStartRow;
};

/**
 * A single item to render. Rows are rendered in normal document flow (no
 * absolute positioning), so there is no `start`/`size` — the browser lays them
 * out.
 *
 * @typeParam TRow - The type of row data returned from queries
 */
export type VirtualRow<TRow> = {
  /** The row's index in the (estimated) full list. */
  index: number;
  /** Stable key for rendering. Row id when loaded, otherwise index-derived. */
  key: RowKey;
  /** The row data, or undefined while the row is still loading. */
  row: TRow | undefined;
};

/**
 * How the viewport is kept stable as off-screen content resizes:
 * - `native`: rely on the browser's CSS `overflow-anchor` (simplest; used where
 *   it's reliable).
 * - `manual`: the momentum-safe manual anchoring (reference-row pinning, with
 *   touch-time corrections held as a content-wrapper margin), for browsers
 *   without native scroll anchoring.
 * - `auto`: feature-detect `overflow-anchor` support (default).
 */
export type AnchoringMode = 'auto' | 'manual' | 'native';

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
