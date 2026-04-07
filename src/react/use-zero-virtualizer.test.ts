import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {useRows} from './use-rows.ts';
import {useZeroVirtualizer} from './use-zero-virtualizer.ts';

vi.mock('./use-rows.ts', () => ({
  useRows: vi.fn(),
}));

const mockUseRows = vi.mocked(useRows);

function makeUseRowsResult(
  overrides: Partial<ReturnType<typeof useRows>>,
): ReturnType<typeof useRows> {
  return {
    rowAt: () => undefined,
    rowsLength: 0,
    complete: false,
    rowsEmpty: true,
    atStart: false,
    atEnd: false,
    firstRowIndex: 0,
    permalinkNotFound: false,
    ...overrides,
  };
}

function makeOptions() {
  const scrollEl = document.createElement('div');
  const listContextParams = {};
  return {
    estimateSize: () => 48,
    getScrollElement: () => scrollEl,
    listContextParams,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPageQuery: () => ({query: null as any}),
    toStartRow: (row: unknown) => row,
    getRowKey: (row: unknown) => row as string,
  } as const;
}

afterEach(() => {
  vi.clearAllMocks();
});

// NUM_ROWS_FOR_LOADING_SKELETON = 1 (internal constant in use-zero-virtualizer)
// estimatedTotal initial value = 1 (NUM_ROWS_FOR_LOADING_SKELETON)
// newEstimatedTotal = firstRowIndex + rowsLength
// count = (atEnd && atStart && complete)
//   ? rowsLength
//   : Math.max(estimatedTotal, newEstimatedTotal) + (!atEnd && rowsLength > 0 ? 1 : 0)
// After effects settle, estimatedTotal may be updated:
//   complete && atStart && atEnd  -> estimatedTotal = Math.max(estimatedTotal, rowsLength)
//   complete && !(atStart&&atEnd) && newEstimatedTotal > estimatedTotal -> estimatedTotal = newEstimatedTotal
// total = (atStart && atEnd) ? rowsLength
//       : (hasReachedStart && hasReachedEnd) ? estimatedTotal
//       : undefined
// hasReachedStart is set by REACHED_START effect when atStart=true
// hasReachedEnd   is set by REACHED_END   effect when atEnd=true

describe('useZeroVirtualizer - virtualizer count and total', () => {
  test.for([
    {
      name: 'empty, loading (no rows yet)',
      // Before fix: count was 2 (estimatedTotal=1 + skeleton=1).
      // After fix: skeleton is suppressed when rowsLength=0.
      rows: {
        rowsLength: 0,
        complete: false,
        rowsEmpty: true,
        atStart: false,
        atEnd: false,
        firstRowIndex: 0,
      },
      expectedCount: 1, // estimatedTotal=1 + no skeleton (rowsLength=0)
      expectedTotal: undefined,
    },
    {
      name: 'empty, complete',
      // Before fix: count was 1 (estimatedTotal stayed at 1 due to Math.max).
      // After fix: the atStart&&atEnd&&complete branch directly yields rowsLength=0.
      rows: {
        rowsLength: 0,
        complete: true,
        rowsEmpty: true,
        atStart: true,
        atEnd: true,
        firstRowIndex: 0,
      },
      expectedCount: 0,
      expectedTotal: 0,
    },
    {
      name: 'loading from top, some rows',
      // estimatedTotal stays 1 (complete=false). newEstimatedTotal=20. +1 skeleton (more to load).
      rows: {
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      },
      expectedCount: 21, // max(1,20) + 1 skeleton
      expectedTotal: undefined,
    },
    {
      name: 'complete at top, more rows below',
      // complete fires UPDATE_ESTIMATED_TOTAL(20). estimatedTotal becomes 20. +1 skeleton.
      rows: {
        rowsLength: 20,
        complete: true,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      },
      expectedCount: 21, // max(20,20) + 1 skeleton
      expectedTotal: undefined, // hasReachedEnd=false
    },
    {
      name: 'single row, complete',
      rows: {
        rowsLength: 1,
        complete: true,
        rowsEmpty: false,
        atStart: true,
        atEnd: true,
        firstRowIndex: 0,
      },
      expectedCount: 1,
      expectedTotal: 1,
    },
    {
      name: 'all rows loaded',
      rows: {
        rowsLength: 20,
        complete: true,
        rowsEmpty: false,
        atStart: true,
        atEnd: true,
        firstRowIndex: 0,
      },
      expectedCount: 20, // atStart&&atEnd&&complete -> rowsLength
      expectedTotal: 20,
    },
    {
      name: 'loading at end, rows above (firstRowIndex>0)',
      // estimatedTotal stays 1 (complete=false). newEstimatedTotal=5+20=25. No skeleton (atEnd=true).
      rows: {
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: false,
        atEnd: true,
        firstRowIndex: 5,
      },
      expectedCount: 25, // max(1,25) + 0 skeleton
      expectedTotal: undefined,
    },
    {
      name: 'complete at end, more rows above (firstRowIndex>0)',
      // complete fires UPDATE_ESTIMATED_TOTAL(25). estimatedTotal=25. No skeleton (atEnd=true).
      rows: {
        rowsLength: 20,
        complete: true,
        rowsEmpty: false,
        atStart: false,
        atEnd: true,
        firstRowIndex: 5,
      },
      expectedCount: 25, // max(25,25) + 0 skeleton
      expectedTotal: undefined, // hasReachedStart=false
    },
    {
      name: 'loading in middle (firstRowIndex>0)',
      // estimatedTotal stays 1 (complete=false). newEstimatedTotal=30+50=80. +1 skeleton.
      rows: {
        rowsLength: 50,
        complete: false,
        rowsEmpty: false,
        atStart: false,
        atEnd: false,
        firstRowIndex: 30,
      },
      expectedCount: 81, // max(1,80) + 1 skeleton
      expectedTotal: undefined,
    },
    {
      name: 'complete in middle (firstRowIndex>0)',
      // complete fires UPDATE_ESTIMATED_TOTAL(60). estimatedTotal=60. +1 skeleton.
      rows: {
        rowsLength: 50,
        complete: true,
        rowsEmpty: false,
        atStart: false,
        atEnd: false,
        firstRowIndex: 10,
      },
      expectedCount: 61, // max(60,60) + 1 skeleton
      expectedTotal: undefined,
    },
  ])('$name', ({rows, expectedCount, expectedTotal}) => {
    mockUseRows.mockReturnValue(makeUseRowsResult(rows));

    const options = makeOptions();
    const {result} = renderHook(() => useZeroVirtualizer(options));

    expect(result.current.total).toBe(expectedTotal);
    expect(result.current.virtualizer.options.count).toBe(expectedCount);
  });
});
