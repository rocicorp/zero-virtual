import {assert, unreachable} from '../asserts.ts';
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
   * The resolved permalink target row (the single-row lookup result), when the
   * current anchor is a permalink and the row has loaded; `undefined`
   * otherwise. Its `getRowKey` locates the DOM row to scroll to — the
   * permalink id need not equal the row key.
   */
  permalinkRow: TRow | undefined;
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

function isPermalink<TStartRow>(
  anchor: Anchor<TStartRow>,
): anchor is Extract<Anchor<TStartRow>, {kind: 'permalink'}> {
  return anchor.kind === 'permalink';
}

/**
 * Stage 1: the single-row lookup (permalink anchors only; null otherwise so
 * wrappers can keep a stable query slot).
 */
export function buildSingleQuery<TQuery, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  getSingleQuery: GetSingleQuery<TQuery>,
): QueryResult<TQuery> | null {
  return isPermalink(inputs.anchor)
    ? getSingleQuery({id: inputs.anchor.id, settled: inputs.settled})
    : null;
}

/**
 * Stage 2: the main page query — page-before rows for a permalink (depends on
 * stage 1's result), or the whole page for forward/backward anchors.
 */
export function buildMainQuery<TQuery, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  getPageQuery: GetPageQuery<TQuery, TStartRow>,
  singleStart: TStartRow | null,
  permalinkNotFound: boolean,
): QueryResult<TQuery> | null {
  const {anchor, pageSize, settled} = inputs;
  if (isPermalink(anchor)) {
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
export function buildAfterQuery<TQuery, TStartRow>(
  inputs: RowsQueryInputs<TStartRow>,
  getPageQuery: GetPageQuery<TQuery, TStartRow>,
  singleStart: TStartRow | null,
  permalinkNotFound: boolean,
): QueryResult<TQuery> | null {
  const {anchor, pageSize, settled} = inputs;
  if (!isPermalink(anchor)) return null;
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
    isPermalink(inputs.anchor) && singleComplete && singleRow === undefined
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

  const rowsBeforeLength = mainRows?.length ?? 0;
  const rowsAfterLength = afterRows?.length ?? 0;
  const rowsBeforeSize = Math.min(rowsBeforeLength, halfPageSize);
  const rowsAfterSize = Math.min(rowsAfterLength, halfPageSize - 1);

  const pageRows = mainRows ?? [];
  const hasMoreRows = kind !== 'permalink' && pageRows.length > pageSize;
  const paginatedRowsLength = hasMoreRows ? pageSize : pageRows.length;

  const rowAt = (index: number): TRow | undefined => {
    switch (kind) {
      case 'permalink': {
        if (index === anchorIndex) {
          return singleRow;
        }
        if (index > anchorIndex) {
          if (afterRows === undefined) return undefined;
          const i = index - anchorIndex - 1;
          return i < rowsAfterSize ? afterRows[i] : undefined;
        }
        if (mainRows === undefined) return undefined;
        const i = anchorIndex - index - 1;
        return i < rowsBeforeSize ? mainRows[i] : undefined;
      }
      case 'forward': {
        const i = index - anchorIndex;
        return i >= 0 && i < paginatedRowsLength ? pageRows[i] : undefined;
      }
      case 'backward': {
        const i = anchorIndex - index - 1;
        return i >= 0 && i < paginatedRowsLength ? pageRows[i] : undefined;
      }
      default:
        unreachable(kind);
    }
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
    };
  }

  const pageStart = anchor.startRow ?? null;

  if (kind === 'forward') {
    return {
      rowAt,
      rowsLength: paginatedRowsLength,
      complete: mainComplete,
      rowsEmpty: pageRows.length === 0,
      atStart: pageStart === null || anchorIndex === 0,
      atEnd: mainComplete && !hasMoreRows,
      firstRowIndex: anchorIndex,
      permalinkNotFound,
      permalinkRow: undefined,
    };
  }

  kind satisfies 'backward';
  assert(pageStart !== null);

  return {
    rowAt,
    rowsLength: paginatedRowsLength,
    complete: mainComplete,
    rowsEmpty: pageRows.length === 0,
    atStart: mainComplete && !hasMoreRows,
    atEnd: false,
    firstRowIndex: anchorIndex - paginatedRowsLength,
    permalinkNotFound,
    permalinkRow: undefined,
  };
}
