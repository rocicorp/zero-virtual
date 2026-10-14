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
  probeID: string | null;
};

/**
 * The assembled, framework-free view over the loaded rows — what the
 * virtualizer consumes. (The return shape of the framework `useRows` hooks.)
 */
export type RowsSnapshot<TRow> = {
  /**
   * The anchor these rows were assembled for: the query inputs' anchor, whose
   * index frame `firstRowIndex` and {@linkcode rowAt} count in. A snapshot
   * lags a re-anchor by at least a commit, and until one for the new anchor
   * arrives these are the previous window's rows, laid out in its frame.
   */
  anchor: Anchor<unknown>;
  /**
   * The page size these rows were assembled for. Like {@linkcode anchor} it
   * lags the query inputs: the page size grows once the viewport is measured,
   * and until the larger page's answer arrives these are the smaller one's.
   */
  pageSize: number;
  rowAt: (index: number) => TRow | undefined;
  rowsLength: number;
  complete: boolean;
  rowsEmpty: boolean;
  atStart: boolean;
  atEnd: boolean;
  firstRowIndex: number;
  /** A permalink anchor's row doesn't exist: its lookup completed empty. */
  permalinkNotFound: boolean;
  /**
   * The single-row lookup — a permalink anchor's row, or under a page anchor
   * the probe's: the id looked up, the row it resolved to (`undefined` while
   * loading or when there is none), and whether it completed. Null when
   * nothing is looked up. A snapshot lags the inputs it is read for, so a
   * reader has to check the id before trusting the rest — it may still be
   * answering the previous lookup. The row's `getRowKey` locates it in the
   * DOM: the id need not equal the row key.
   */
  lookup: {id: string; row: TRow | undefined; complete: boolean} | null;
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
 * Stage 1: the single-row lookup for a permalink anchor or a page anchor's
 * probeID. Returns null when neither is present, so wrappers can keep a stable
 * query slot.
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
  const id = anchor.kind === 'permalink' ? anchor.id : probeID;
  return id === null ? null : getSingleQuery({id, settled});
}

/**
 * Stages 2 and 3, the page queries. Under a page anchor, the whole page.
 * Under a permalink anchor, the pages before and after its row, once stage 1
 * has found it.
 */
export function buildPageQueries<TRow, TQuery, TOptions, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  getPageQuery: GetPageQuery<TQuery, TOptions, TStartRow>,
  toStartRow: (row: TRow) => TStartRow,
  singleRow: TRow | undefined,
): {
  main: QueryResult<TQuery, TOptions> | null;
  after: QueryResult<TQuery, TOptions> | null;
} {
  const {anchor, pageSize, settled} = inputs;
  if (anchor.kind !== 'permalink') {
    const start = anchor.startRow ?? null;
    return {
      main: getPageQuery({
        limit: pageSize + 1,
        start,
        dir: anchor.kind,
        settled,
      }),
      after: null,
    };
  }
  assert(pageSize % 2 === 0);
  if (singleRow === undefined) return {main: null, after: null};
  const start = toStartRow(singleRow);
  const half = pageSize / 2;
  return {
    main: getPageQuery({limit: half + 1, start, dir: 'backward', settled}),
    after: getPageQuery({limit: half, start, dir: 'forward', settled}),
  };
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

  const permalinkNotFound =
    kind === 'permalink' && singleComplete && singleRow === undefined;
  const lookupID = kind === 'permalink' ? anchor.id : inputs.probeID;
  const lookup =
    lookupID === null
      ? null
      : {id: lookupID, row: singleRow, complete: singleComplete};

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
      anchor,
      pageSize,
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
      lookup,
    };
  }

  const forward = kind === 'forward';
  const pageStart = anchor.startRow ?? null;
  assert(forward || pageStart !== null);
  return {
    anchor,
    pageSize,
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
    lookup,
  };
}
