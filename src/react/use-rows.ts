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

const returnUndefined = () => undefined;

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
  let permalinkNotFound = false;

  if (kind === 'permalink') {
    const {id} = anchor;
    assert(id);
    assert(pageSize % 2 === 0);

    const halfPageSize = pageSize / 2;

    const qItem = getSingleQuery(id);

    const [row, resultRow] = useQuery(qItem, options);
    const completeRow = resultRow.type === 'complete';

    const typedRow = row as TRow | undefined;

    // Early return if permalink not found to skip unnecessary queries
    if (completeRow && typedRow === undefined) {
      // Call dummy useQuery to maintain hooks call order
      void useQuery(null, options);
      void useQuery(null, options);

      return {
        rowAt: returnUndefined,
        rowsLength: 0,
        complete: true,
        rowsEmpty: true,
        atStart: true,
        atEnd: true,
        firstRowIndex: anchorIndex,
        permalinkNotFound: true,
      };
    }

    const start = typedRow && toStartRow(typedRow);

    const qBefore = start && getPageQuery(halfPageSize + 1, start, 'backward');
    const qAfter = start && getPageQuery(halfPageSize, start, 'forward');

    const [rowsBefore, resultBefore] = useQuery(qBefore, options);
    const [rowsAfter, resultAfter] = useQuery(qAfter, options);
    const completeBefore = resultBefore.type === 'complete';
    const completeAfter = resultAfter.type === 'complete';

    const typedRowsBefore = rowsBefore as unknown as TRow[] | undefined;
    const typedRowsAfter = rowsAfter as unknown as TRow[] | undefined;
    const rowsBeforeLength = typedRowsBefore?.length ?? 0;
    const rowsAfterLength = typedRowsAfter?.length ?? 0;
    const rowsBeforeSize = Math.min(rowsBeforeLength, halfPageSize);
    const rowsAfterSize = Math.min(rowsAfterLength, halfPageSize - 1);

    const firstRowIndex = anchorIndex - rowsBeforeSize;

    return {
      rowAt: useCallback(
        (index: number) => {
          if (index === anchorIndex) {
            return typedRow;
          }
          if (index > anchorIndex) {
            if (typedRowsAfter === undefined) {
              return undefined;
            }
            const i = index - anchorIndex - 1;
            if (i >= rowsAfterSize) {
              return undefined;
            }
            return typedRowsAfter[i];
          }
          assert(index < anchorIndex);
          if (typedRowsBefore === undefined) {
            return undefined;
          }
          const i = anchorIndex - index - 1;
          if (i >= rowsBeforeSize) {
            return undefined;
          }
          return typedRowsBefore[i];
        },
        [
          anchorIndex,
          typedRow,
          typedRowsBefore,
          typedRowsAfter,
          rowsBeforeSize,
          rowsAfterSize,
        ],
      ),
      rowsLength: rowsBeforeSize + rowsAfterSize + (typedRow ? 1 : 0),
      complete:
        completeRow &&
        (typedRow === undefined || (completeBefore && completeAfter)),
      rowsEmpty:
        typedRow === undefined || (rowsBeforeSize === 0 && rowsAfterSize === 0),
      atStart: completeBefore && rowsBeforeLength <= halfPageSize,
      atEnd: completeAfter && rowsAfterLength <= halfPageSize - 1,
      firstRowIndex: firstRowIndex,
      permalinkNotFound,
    };
  }

  kind satisfies 'forward' | 'backward';

  const {startRow: start = null} = anchor;

  const q = getPageQuery(pageSize + 1, start, kind);

  const [rows, result] = useQuery(q, options);
  // not used but needed to follow rules of hooks
  void useQuery(null, options);
  void useQuery(null, options);

  const typedRows = rows as unknown as TRow[];
  const complete = result.type === 'complete';
  const hasMoreRows = typedRows.length > pageSize;
  const rowsLength = hasMoreRows ? pageSize : typedRows.length;
  const rowsEmpty = typedRows.length === 0;

  if (kind === 'forward') {
    return {
      rowAt: useCallback(
        (index: number) =>
          index - anchorIndex < rowsLength
            ? typedRows[index - anchorIndex]
            : undefined,
        [anchorIndex, typedRows, rowsLength],
      ),
      rowsLength: rowsLength,
      complete,
      rowsEmpty: rowsEmpty,
      atStart: start === null || anchorIndex === 0,
      atEnd: complete && !hasMoreRows,
      firstRowIndex: anchorIndex,
      permalinkNotFound,
    };
  }

  kind satisfies 'backward';
  assert(start !== null);

  return {
    rowAt: useCallback(
      (index: number) => {
        if (index >= anchorIndex) {
          return undefined;
        }
        const i = anchorIndex - index - 1;
        if (i < 0 || i >= rowsLength) {
          return undefined;
        }
        return typedRows[i];
      },
      [anchorIndex, typedRows, rowsLength],
    ),
    rowsLength: rowsLength,
    complete,
    rowsEmpty: rowsEmpty,
    atStart: complete && !hasMoreRows,
    atEnd: false,
    firstRowIndex: anchorIndex - rowsLength,
    permalinkNotFound,
  };
}
