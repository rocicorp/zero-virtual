import type {
  DefaultContext,
  DefaultSchema,
  QueryOrQueryRequest,
} from '@rocicorp/zero';

/**
 * Zero's query time-to-live. Replicated structurally (`@rocicorp/zero` doesn't
 * export it from its root entry, and this package's core must stay
 * framework-free) — assignable to the `ttl` of both the react and solid
 * `UseQueryOptions`.
 */
export type TTL =
  | `${number}${'s' | 'm' | 'h' | 'd' | 'y'}`
  | 'forever'
  | 'none'
  | number;

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
 * Per-query options, framework-free. Structurally assignable to the
 * `UseQueryOptions` of both `@rocicorp/zero/react` and `@rocicorp/zero/solid`.
 */
export type QueryOptions = {
  enabled?: boolean | undefined;
  ttl?: TTL | undefined;
};

/** Result returned by query functions: a query plus optional per-query options. */
export type QueryResult<TReturn> = {
  query: GetQueryReturnType<TReturn>;
  options?: QueryOptions;
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
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export type GetPageQuery<TRow, TStartRow> = (
  options: GetPageQueryOptions<TStartRow>,
) => QueryResult<TRow>;

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
 * @typeParam TRow - The type of row data returned from queries
 */
export type GetSingleQuery<TRow> = (
  options: GetSingleQueryOptions,
) => QueryResult<TRow | undefined>;

/**
 * The query wiring the framework bindings add on top of the core options
 * (the query functions are bound via `@rocicorp/zero/react` or
 * `@rocicorp/zero/solid`).
 *
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export type VirtualizerQueryOptions<TRow, TStartRow> = {
  /** Function that returns a query for fetching a page of rows */
  getPageQuery: GetPageQuery<TRow, TStartRow>;
  /** Function that returns a query for fetching a single row by ID */
  getSingleQuery: GetSingleQuery<TRow>;
  /** Function to extract the start row data from a full row (for pagination anchoring) */
  toStartRow: (row: TRow) => TStartRow;
};

/**
 * Return type of a Zero query or query request.
 *
 * @typeParam TReturn - The type of the query return value
 */
export type GetQueryReturnType<TReturn> = QueryOrQueryRequest<
  keyof DefaultSchema['tables'] & string,
  // oxlint-disable-next-line no-explicit-any
  any, // input
  // oxlint-disable-next-line no-explicit-any
  any, // output
  DefaultSchema,
  TReturn,
  DefaultContext
>;

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
