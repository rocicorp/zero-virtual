import type {
  DefaultContext,
  DefaultSchema,
  QueryOrQueryRequest,
} from '@rocicorp/zero';
import type {
  GetPageQuery as CoreGetPageQuery,
  GetSingleQuery as CoreGetSingleQuery,
  QueryResult as CoreQueryResult,
} from './core/types.ts';
import type {VirtualizerBindingOptions as CoreVirtualizerBindingOptions} from './core/virtualizer.ts';

/**
 * The Zero instantiations of the core's query-agnostic types, shared by the
 * `./react` and `./solid` entry points. The core itself is library-agnostic
 * (its query types are opaque generics); this module pins them to Zero
 * queries so the bindings' public API is expressed in terms of the row type,
 * exactly as before.
 */

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
 * Result returned by query functions: a Zero query plus optional per-query
 * options.
 *
 * @typeParam TReturn - The type of the query return value
 */
export type QueryResult<TReturn> = CoreQueryResult<GetQueryReturnType<TReturn>>;

/**
 * Function that returns a Zero query for fetching a page of rows.
 *
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export type GetPageQuery<TRow, TStartRow> = CoreGetPageQuery<
  GetQueryReturnType<TRow>,
  TStartRow
>;

/**
 * Function that returns a Zero query for fetching a single row by ID.
 *
 * @typeParam TRow - The type of row data returned from queries
 */
export type GetSingleQuery<TRow> = CoreGetSingleQuery<
  GetQueryReturnType<TRow | undefined>
>;

/**
 * The core's binding options with the query types pinned to Zero queries
 * (bound via `@rocicorp/zero/react` or `@rocicorp/zero/solid`).
 *
 * @typeParam TListContextParams - The type of parameters that define the list's query context
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export type VirtualizerBindingOptions<TListContextParams, TRow, TStartRow> =
  CoreVirtualizerBindingOptions<
    TListContextParams,
    TRow,
    TStartRow,
    GetQueryReturnType<TRow>,
    GetQueryReturnType<TRow | undefined>
  >;
