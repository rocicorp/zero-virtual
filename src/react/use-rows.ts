import type {
  DefaultContext,
  DefaultSchema,
  QueryOrQueryRequest,
} from '@rocicorp/zero';
import {useQuery, type UseQueryOptions} from '@rocicorp/zero/react';
import {useCallback} from 'react';
import {assert} from '../asserts.ts';

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
 * Function that returns a query for fetching a page of rows.
 *
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 *
 * @param limit - The maximum number of rows to return
 * @param start - The start row data to anchor the query, or null if starting from the beginning
 * @param dir - The direction to paginate ('forward' or 'backward')
 * @returns A Zero query or query request
 */
export type GetPageQuery<TRow, TStartRow> = (
  limit: number,
  start: TStartRow | null,
  dir: 'forward' | 'backward',
) => GetQueryReturnType<TRow>;

/**
 * Function that returns a query for fetching a single row by ID.
 *
 * @typeParam TRow - The type of row data returned from queries
 *
 * @param id - The ID of the row to fetch
 * @returns A Zero query or query request
 */
export type GetSingleQuery<TRow> = (
  id: string,
) => GetQueryReturnType<TRow | undefined>;

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
 * Internal hook that manages the fetching and caching of rows for the virtualizer.
 *
 * @typeParam TRow - The type of row data returned from queries
 * @typeParam TStartRow - The type of data needed to anchor pagination
 */
export function useRows<TRow, TStartRow>({
  pageSize,
  anchor,
  options,
  getPageQuery,
  getSingleQuery,
  toStartRow,
}: {
  pageSize: number;
  anchor: Anchor<TStartRow>;
  options?: UseQueryOptions | undefined;

  getPageQuery: GetPageQuery<TRow, TStartRow>;
  getSingleQuery: GetSingleQuery<TRow>;
  toStartRow: (row: TRow) => TStartRow;
}): {
  rowAt: (index: number) => TRow | undefined;
  rowsLength: number;
  complete: boolean;
  rowsEmpty: boolean;
  atStart: boolean;
  atEnd: boolean;
  firstRowIndex: number;
  permalinkNotFound: boolean;
} {
  const {kind, index: anchorIndex} = anchor;
  const isPermalink = kind === 'permalink';
  assert(!isPermalink || pageSize % 2 === 0);
  const halfPageSize = pageSize / 2;

  // --- All hooks called unconditionally, in the same order on every render ---

  // Hook 1: single-item lookup (permalink only; null otherwise keeps hook count stable)
  const permalinkId = isPermalink
    ? (anchor as Extract<Anchor<TStartRow>, {kind: 'permalink'}>).id
    : '';
  const [singleRow, singleResult] = useQuery(
    isPermalink ? getSingleQuery(permalinkId) : null,
    options,
  );
  const typedSingleRow = singleRow as TRow | undefined;
  const completeRow = singleResult.type === 'complete';
  const permalinkNotFound =
    isPermalink && completeRow && typedSingleRow === undefined;

  const singleStart = typedSingleRow ? toStartRow(typedSingleRow) : null;
  const pageStart = !isPermalink
    ? ((anchor as Extract<Anchor<TStartRow>, {kind: 'forward' | 'backward'}>)
        .startRow ?? null)
    : null;

  // Hook 2: page-before rows (permalink) OR main page rows (forward/backward)
  const q2 = isPermalink
    ? !permalinkNotFound && singleStart
      ? getPageQuery(halfPageSize + 1, singleStart, 'backward')
      : null
    : getPageQuery(pageSize + 1, pageStart, kind as 'forward' | 'backward');
  const [rows2, result2] = useQuery(q2, options);

  // Hook 3: page-after rows (permalink only; null for forward/backward)
  const q3 =
    isPermalink && !permalinkNotFound && singleStart
      ? getPageQuery(halfPageSize, singleStart, 'forward')
      : null;
  const [rows3, result3] = useQuery(q3, options);

  // Derive values needed in useCallback before calling it
  const typedRows2 = rows2 as unknown as TRow[] | undefined;
  const typedRows3 = rows3 as unknown as TRow[] | undefined;

  const rowsBeforeLength = typedRows2?.length ?? 0;
  const rowsAfterLength = typedRows3?.length ?? 0;
  const rowsBeforeSize = Math.min(rowsBeforeLength, halfPageSize);
  const rowsAfterSize = Math.min(rowsAfterLength, halfPageSize - 1);

  const typedPageRows = (typedRows2 ?? []) as TRow[];
  const hasMoreRows = !isPermalink && typedPageRows.length > pageSize;
  const paginatedRowsLength = hasMoreRows ? pageSize : typedPageRows.length;

  // Hook 4: single unified rowAt — same hook, same dep-array size, every render
  const rowAt = useCallback(
    (index: number): TRow | undefined => {
      if (isPermalink) {
        if (index === anchorIndex) {
          return typedSingleRow;
        }
        if (index > anchorIndex) {
          if (typedRows3 === undefined) return undefined;
          const i = index - anchorIndex - 1;
          return i < rowsAfterSize ? typedRows3[i] : undefined;
        }
        if (typedRows2 === undefined) return undefined;
        const i = anchorIndex - index - 1;
        return i < rowsBeforeSize ? typedRows2[i] : undefined;
      }
      if (kind === 'forward') {
        const i = index - anchorIndex;
        return i >= 0 && i < paginatedRowsLength ? typedPageRows[i] : undefined;
      }
      // backward
      const i = anchorIndex - index - 1;
      return i >= 0 && i < paginatedRowsLength ? typedPageRows[i] : undefined;
    },
    [
      isPermalink,
      kind,
      anchorIndex,
      typedSingleRow,
      typedRows2,
      typedRows3,
      rowsBeforeSize,
      rowsAfterSize,
      typedPageRows,
      paginatedRowsLength,
    ],
  );

  // --- Pure value branching (no hooks below this line) ---

  const complete2 = result2.type === 'complete';
  const complete3 = result3.type === 'complete';

  if (isPermalink) {
    return {
      rowAt,
      rowsLength: permalinkNotFound
        ? 0
        : rowsBeforeSize + rowsAfterSize + (typedSingleRow ? 1 : 0),
      complete: completeRow && (permalinkNotFound || (complete2 && complete3)),
      rowsEmpty:
        permalinkNotFound ||
        typedSingleRow === undefined ||
        (rowsBeforeSize === 0 && rowsAfterSize === 0),
      atStart:
        permalinkNotFound || (complete2 && rowsBeforeLength <= halfPageSize),
      atEnd:
        permalinkNotFound || (complete3 && rowsAfterLength <= halfPageSize - 1),
      firstRowIndex: permalinkNotFound
        ? anchorIndex
        : anchorIndex - rowsBeforeSize,
      permalinkNotFound,
    };
  }

  kind satisfies 'forward' | 'backward';

  if (kind === 'forward') {
    return {
      rowAt,
      rowsLength: paginatedRowsLength,
      complete: complete2,
      rowsEmpty: typedPageRows.length === 0,
      atStart: pageStart === null || anchorIndex === 0,
      atEnd: complete2 && !hasMoreRows,
      firstRowIndex: anchorIndex,
      permalinkNotFound: false,
    };
  }

  kind satisfies 'backward';
  assert(pageStart !== null);

  return {
    rowAt,
    rowsLength: paginatedRowsLength,
    complete: complete2,
    rowsEmpty: typedPageRows.length === 0,
    atStart: complete2 && !hasMoreRows,
    atEnd: false,
    firstRowIndex: anchorIndex - paginatedRowsLength,
    permalinkNotFound: false,
  };
}
