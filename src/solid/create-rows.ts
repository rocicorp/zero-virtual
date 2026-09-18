import {useQuery} from '@rocicorp/zero/solid';
import {createMemo, type Accessor} from 'solid-js';
import {
  assembleRows,
  buildAfterQuery,
  buildMainQuery,
  buildProbeQuery,
  buildSingleQuery,
  permalinkMissing,
  type RowsQueryInputs,
  type RowsSnapshot,
} from '../core/rows.ts';
import type {GetPageQuery, GetSingleQuery} from '../zero-types.ts';

/**
 * Binds the virtualizer's staged queries to Zero's Solid bindings. All
 * windowing math lives in the framework-free core ({@linkcode assembleRows});
 * this owns only the query staging — four `useQuery` slots (queries 2 and 3
 * depend on query 1's result for permalink anchors; query 4, the id probe, is
 * independent of all of them), each fed by an accessor so Solid re-subscribes
 * reactively as the inputs change.
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
  // Stage 4: the `probeID` existence check (see buildProbeQuery). It depends on
  // nothing else and nothing else depends on it, so its position among the
  // slots is free — it sits here only to keep the two lookups together.
  const q4 = createMemo(() =>
    buildProbeQuery(args.inputs(), args.getSingleQuery()),
  );
  const [probeRow, probeDetails] = useQuery(
    () => q4()?.query ?? null,
    () => q4()?.options ?? {},
  );
  const typedProbeRow = () => probeRow() as TRow | undefined;
  const probeComplete = () => probeDetails().type === 'complete';

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
      probeRow: typedProbeRow(),
      probeComplete: probeComplete(),
    }),
  );
}
