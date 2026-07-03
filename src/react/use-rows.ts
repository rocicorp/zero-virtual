import {useQuery} from '@rocicorp/zero/react';
import {useMemo} from 'react';
import {
  assembleRows,
  buildAfterQuery,
  buildMainQuery,
  buildSingleQuery,
  permalinkMissing,
  type RowsSnapshot,
} from '../core/rows.ts';
import type {
  Anchor,
  GetPageQuery,
  GetSingleQuery,
} from '../core/types.ts';

/**
 * Internal hook that binds the virtualizer's staged queries to Zero's React
 * bindings. All windowing math lives in the framework-free core
 * ({@linkcode assembleRows}); this hook owns only the query staging — three
 * `useQuery` slots, called unconditionally in the same order every render
 * (queries 2 and 3 depend on query 1's result for permalink anchors).
 */
export function useRows<TRow, TStartRow>({
  pageSize,
  anchor,
  settled,
  getPageQuery,
  getSingleQuery,
  toStartRow,
}: {
  pageSize: number;
  anchor: Anchor<TStartRow>;
  settled: boolean;

  getPageQuery: GetPageQuery<TRow, TStartRow>;
  getSingleQuery: GetSingleQuery<TRow>;
  toStartRow: (row: TRow) => TStartRow;
}): RowsSnapshot<TRow> {
  const inputs = {pageSize, anchor, settled};

  // Stage 1: single-item lookup (permalink only; null keeps the slot stable).
  const q1 = buildSingleQuery(inputs, getSingleQuery);
  const [singleRow, singleResult] = useQuery(q1?.query ?? null, q1?.options);
  const typedSingleRow = singleRow as TRow | undefined;
  const singleComplete = singleResult.type === 'complete';

  const notFound = permalinkMissing(inputs, typedSingleRow, singleComplete);
  const singleStart = typedSingleRow ? toStartRow(typedSingleRow) : null;

  // Stage 2: page-before rows (permalink) OR the main page rows.
  const q2 = buildMainQuery(inputs, getPageQuery, singleStart, notFound);
  const [mainRows, mainResult] = useQuery(q2?.query ?? null, q2?.options);

  // Stage 3: page-after rows (permalink only).
  const q3 = buildAfterQuery(inputs, getPageQuery, singleStart, notFound);
  const [afterRows, afterResult] = useQuery(q3?.query ?? null, q3?.options);

  const mainComplete = mainResult.type === 'complete';
  const afterComplete = afterResult.type === 'complete';

  // Memoized so the snapshot (and its rowAt identity) is stable across
  // renders whose query results didn't change.
  return useMemo(
    () =>
      assembleRows(
        {pageSize, anchor, settled},
        {
          singleRow: typedSingleRow,
          singleComplete,
          mainRows: mainRows as unknown as TRow[] | undefined,
          mainComplete,
          afterRows: afterRows as unknown as TRow[] | undefined,
          afterComplete,
        },
      ),
    [
      pageSize,
      anchor,
      settled,
      typedSingleRow,
      singleComplete,
      mainRows,
      mainComplete,
      afterRows,
      afterComplete,
    ],
  );
}
