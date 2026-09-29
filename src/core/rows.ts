import {assert} from '../asserts.ts';
import type {
  Anchor,
  GetPageQuery,
  GetSingleQuery,
  QueryResult,
} from './types.ts';

/**
 * The inputs that determine which queries the virtualizer needs. Produced by
 * the core, consumed by the framework wrappers, which feed them into their
 * framework's Zero query binding and return the results via
 * {@linkcode assembleRows}.
 */
export type RowsQueryInputs<TStartRow> = {
  pageSize: number;
  anchor: Anchor<TStartRow>;
  settled: boolean;
  /**
   * An id to look up *without* moving the query window: the single-row query
   * runs for it while the anchor (and so the loaded rows) stays put. This is
   * how `scrollToItem` — and an in-page permalink navigation over an already
   * loaded list — checks that a row exists before re-anchoring on it, so an
   * id that resolves to nothing leaves the list alone instead of emptying it.
   * Null when the anchor is a permalink (which runs its own lookup) or when
   * nothing is being probed.
   */
  probeID?: string | null | undefined;
};

/**
 * The assembled, framework-free view over the loaded rows — what the
 * virtualizer consumes. (The return shape of the framework `useRows` hooks.)
 */
export type RowsSnapshot<TRow> = {
  rowAt: (index: number) => TRow | undefined;
  rowsLength: number;
  complete: boolean;
  rowsEmpty: boolean;
  atStart: boolean;
  atEnd: boolean;
  firstRowIndex: number;
  permalinkNotFound: boolean;
  /**
   * The id {@linkcode probeRow} and {@linkcode probeComplete} are about, or
   * null when nothing is being probed. A snapshot lags the request it is read
   * for, so a reader has to check this before trusting either of them for a
   * particular id — they may still be answering the previous one.
   */
  probeID: string | null;
  /**
   * The row `probeID` resolved to, when the probe has completed and found
   * one; `undefined` while it is loading, when it found nothing, or when
   * nothing is being probed. Read together with {@linkcode probeComplete}.
   */
  probeRow: TRow | undefined;
  /** Whether the `probeID` lookup has completed (false when not probing). */
  probeComplete: boolean;
  /**
   * The resolved permalink target row (the single-row lookup result), when the
   * current anchor is a permalink and the row has loaded; `undefined`
   * otherwise. Its `getRowKey` locates the DOM row to scroll to — the
   * permalink id need not equal the row key.
   */
  permalinkRow: TRow | undefined;
  /**
   * The id {@linkcode permalinkRow} and {@linkcode permalinkNotFound} are
   * about, or null under a page anchor. A snapshot can lag a re-anchor by a
   * commit or two, so a reader has to check this before trusting either of
   * them for a particular id — they may still be answering the previous one.
   */
  permalinkID: string | null;
};

/** The raw results of the (up to) three staged queries. */
export type RowsQueryResults<TRow> = {
  /** Single-row permalink lookup result (undefined while loading). */
  singleRow: TRow | undefined;
  singleComplete: boolean;
  /** Page-before rows (permalink) or the main page rows (forward/backward). */
  mainRows: TRow[] | undefined;
  mainComplete: boolean;
  /** Page-after rows (permalink only). */
  afterRows: TRow[] | undefined;
  afterComplete: boolean;
};

/**
 * Stage 1: the single-row lookup (permalink anchors only; null otherwise so
 * wrappers can keep a stable query slot).
 */
export function buildSingleQuery<TQuery, TOptions, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  getSingleQuery: GetSingleQuery<TQuery, TOptions>,
): QueryResult<TQuery, TOptions> | null {
  const {anchor, probeID, settled} = inputs;
  // One query slot serves both lookups. Probing while a permalink owns it
  // would silently leave one request waiting for an answer that cannot arrive.
  if (anchor.kind === 'permalink') {
    assert(
      !probeID,
      'probeID must be null while the anchor is a permalink: they share a query slot',
    );
  }
  const id = anchor.kind === 'permalink' ? anchor.id : (probeID ?? null);
  return id === null ? null : getSingleQuery({id, settled});
}

/**
 * Stage 2: the main page query — page-before rows for a permalink (depends on
 * stage 1's result), or the whole page for forward/backward anchors.
 */
export function buildMainQuery<TQuery, TOptions, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  getPageQuery: GetPageQuery<TQuery, TOptions, TStartRow>,
  singleStart: TStartRow | null,
  permalinkNotFound: boolean,
): QueryResult<TQuery, TOptions> | null {
  const {anchor, pageSize, settled} = inputs;
  if (anchor.kind === 'permalink') {
    assert(pageSize % 2 === 0);
    return !permalinkNotFound && singleStart
      ? getPageQuery({
          limit: pageSize / 2 + 1,
          start: singleStart,
          dir: 'backward',
          settled,
        })
      : null;
  }
  return getPageQuery({
    limit: pageSize + 1,
    start: anchor.startRow ?? null,
    dir: anchor.kind,
    settled,
  });
}

/**
 * Stage 3: the page-after query (permalink anchors only; depends on stage 1's
 * result).
 */
export function buildAfterQuery<TQuery, TOptions, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  getPageQuery: GetPageQuery<TQuery, TOptions, TStartRow>,
  singleStart: TStartRow | null,
  permalinkNotFound: boolean,
): QueryResult<TQuery, TOptions> | null {
  const {anchor, pageSize, settled} = inputs;
  if (anchor.kind !== 'permalink') return null;
  assert(pageSize % 2 === 0);
  return !permalinkNotFound && singleStart
    ? getPageQuery({
        limit: pageSize / 2,
        start: singleStart,
        dir: 'forward',
        settled,
      })
    : null;
}

/** Whether a permalink anchor's target row is complete-and-missing. */
export function permalinkMissing<TRow, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  singleRow: TRow | undefined,
  singleComplete: boolean,
): boolean {
  return (
    inputs.anchor.kind === 'permalink' &&
    singleComplete &&
    singleRow === undefined
  );
}

/**
 * Assemble the framework-free rows view from the staged query results. Pure —
 * the framework wrappers own query subscription and staging; this owns all
 * the windowing math.
 */
export function assembleRows<TRow, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  results: RowsQueryResults<TRow>,
): RowsSnapshot<TRow> {
  const {anchor, pageSize} = inputs;
  const {kind, index: anchorIndex} = anchor;
  const halfPageSize = pageSize / 2;
  const {
    singleRow,
    singleComplete,
    mainRows,
    mainComplete,
    afterRows,
    afterComplete,
  } = results;

  const permalinkNotFound = permalinkMissing(inputs, singleRow, singleComplete);

  // Under a page anchor the single-row slot is the probe's, so
  // its result is the probe's answer.
  const probing = anchor.kind !== 'permalink' && !!inputs.probeID;
  const probe = {
    probeID: probing ? (inputs.probeID ?? null) : null,
    probeRow: probing ? singleRow : undefined,
    probeComplete: probing && singleComplete,
  };

  const rowsBeforeLength = mainRows?.length ?? 0;
  const rowsAfterLength = afterRows?.length ?? 0;
  const rowsBeforeSize = Math.min(rowsBeforeLength, halfPageSize);
  const rowsAfterSize = Math.min(rowsAfterLength, halfPageSize - 1);

  const pageRows = mainRows ?? [];
  const hasMoreRows = kind !== 'permalink' && pageRows.length > pageSize;
  const paginatedRowsLength = hasMoreRows ? pageSize : pageRows.length;

  // Both page directions use the same bounded lookup. Keep this lazy: Solid
  // rows may be reactive proxies, and callers must see their current values.
  const rowAt = (index: number): TRow | undefined => {
    if (kind === 'permalink' && index === anchorIndex) return singleRow;
    const forward =
      kind === 'forward' || (kind === 'permalink' && index > anchorIndex);
    const source = kind === 'permalink' && forward ? afterRows : mainRows;
    const size =
      kind === 'permalink'
        ? forward
          ? rowsAfterSize
          : rowsBeforeSize
        : paginatedRowsLength;
    const offset = forward
      ? index - anchorIndex - (kind === 'permalink' ? 1 : 0)
      : anchorIndex - index - 1;
    return offset >= 0 && offset < size ? source?.[offset] : undefined;
  };

  if (kind === 'permalink') {
    return {
      rowAt,
      rowsLength: permalinkNotFound
        ? 0
        : rowsBeforeSize + rowsAfterSize + (singleRow ? 1 : 0),
      complete:
        singleComplete &&
        (permalinkNotFound || (mainComplete && afterComplete)),
      rowsEmpty:
        permalinkNotFound ||
        singleRow === undefined ||
        (rowsBeforeSize === 0 && rowsAfterSize === 0),
      atStart:
        permalinkNotFound || (mainComplete && rowsBeforeLength <= halfPageSize),
      atEnd:
        permalinkNotFound ||
        (afterComplete && rowsAfterLength <= halfPageSize - 1),
      firstRowIndex: permalinkNotFound
        ? anchorIndex
        : anchorIndex - rowsBeforeSize,
      permalinkNotFound,
      permalinkRow: singleRow,
      permalinkID: anchor.id,
      ...probe,
    };
  }

  const forward = kind === 'forward';
  const pageStart = anchor.startRow ?? null;
  assert(forward || pageStart !== null);
  return {
    rowAt,
    rowsLength: paginatedRowsLength,
    complete: mainComplete,
    rowsEmpty: pageRows.length === 0,
    atStart: forward
      ? pageStart === null || anchorIndex === 0
      : mainComplete && !hasMoreRows,
    atEnd: forward && mainComplete && !hasMoreRows,
    firstRowIndex: forward ? anchorIndex : anchorIndex - paginatedRowsLength,
    permalinkNotFound,
    permalinkRow: undefined,
    permalinkID: null,
    ...probe,
  };
}
