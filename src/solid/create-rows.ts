import {useQuery} from '@rocicorp/zero/solid';
import {createMemo, type Accessor} from 'solid-js';
import {
  assembleRows,
  buildAfterQuery,
  buildMainQuery,
  buildSingleQuery,
  permalinkMissing,
  type RowsQueryInputs,
  type RowsSnapshot,
} from '../core/rows.ts';
import type {GetPageQuery, GetSingleQuery} from '../core/types.ts';

/**
 * Binds the virtualizer's staged queries to Zero's Solid bindings. All
 * windowing math lives in the framework-free core ({@linkcode assembleRows});
 * this owns only the query staging — three `useQuery` slots (queries 2 and 3
 * depend on query 1's result for permalink anchors), each fed by an accessor
 * so Solid re-subscribes reactively as the inputs change.
 */
export function createRows<TRow, TStartRow>(args: {
  inputs: Accessor<RowsQueryInputs<TStartRow>>;
  getPageQuery: Accessor<GetPageQuery<TRow, TStartRow>>;
  getSingleQuery: Accessor<GetSingleQuery<TRow>>;
  toStartRow: Accessor<(row: TRow) => TStartRow>;
}): Accessor<RowsSnapshot<TRow>> {
  // Stage 1: single-item lookup (permalink only; null keeps the slot stable).
  const q1 = createMemo(() =>
    buildSingleQuery(args.inputs(), args.getSingleQuery()),
  );
  const [singleRow, singleDetails] = useQuery(
    () => q1()?.query ?? null,
    () => q1()?.options ?? {},
  );
  const typedSingleRow = () => singleRow() as TRow | undefined;
  const singleComplete = () => singleDetails().type === 'complete';
  const notFound = () =>
    permalinkMissing(args.inputs(), typedSingleRow(), singleComplete());
  const singleStart = () => {
    const row = typedSingleRow();
    return row ? args.toStartRow()(row) : null;
  };

  // Stage 2: page-before rows (permalink) OR the main page rows.
  const q2 = createMemo(() =>
    buildMainQuery(
      args.inputs(),
      args.getPageQuery(),
      singleStart(),
      notFound(),
    ),
  );
  const [mainRows, mainDetails] = useQuery(
    () => q2()?.query ?? null,
    () => q2()?.options ?? {},
  );

  // Stage 3: page-after rows (permalink only).
  const q3 = createMemo(() =>
    buildAfterQuery(
      args.inputs(),
      args.getPageQuery(),
      singleStart(),
      notFound(),
    ),
  );
  const [afterRows, afterDetails] = useQuery(
    () => q3()?.query ?? null,
    () => q3()?.options ?? {},
  );

  return createMemo(() =>
    assembleRows(args.inputs(), {
      singleRow: typedSingleRow(),
      singleComplete: singleComplete(),
      mainRows: mainRows() as unknown as TRow[] | undefined,
      mainComplete: mainDetails().type === 'complete',
      afterRows: afterRows() as unknown as TRow[] | undefined,
      afterComplete: afterDetails().type === 'complete',
    }),
  );
}
