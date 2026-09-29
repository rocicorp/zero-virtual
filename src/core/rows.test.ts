import {describe, expect, test} from 'vitest';
import {assembleRows, type RowsQueryResults} from './rows.ts';

const complete: RowsQueryResults<string> = {
  singleRow: undefined,
  singleComplete: true,
  mainRows: undefined,
  mainComplete: true,
  afterRows: undefined,
  afterComplete: true,
};

describe('row window boundaries', () => {
  test.each(['forward', 'backward'] as const)(
    '%s pages exclude the sentinel and retain query order',
    kind => {
      const rows = assembleRows(
        {
          pageSize: 4,
          settled: false,
          anchor: {kind, index: 10, startRow: 'cursor'},
        },
        {...complete, mainRows: ['a', 'b', 'c', 'd', 'sentinel']},
      );
      const first = kind === 'forward' ? 10 : 6;
      expect(rows.firstRowIndex).toBe(first);
      expect(rows.rowsLength).toBe(4);
      expect(rows.atStart).toBe(false);
      expect(rows.atEnd).toBe(false);
      expect(Array.from({length: 4}, (_, i) => rows.rowAt(first + i))).toEqual(
        kind === 'forward' ? ['a', 'b', 'c', 'd'] : ['d', 'c', 'b', 'a'],
      );
      expect(rows.rowAt(first - 1)).toBeUndefined();
      expect(rows.rowAt(first + 4)).toBeUndefined();
    },
  );

  test('permalink pages reserve the center row and exclude both sentinels', () => {
    const rows = assembleRows(
      {
        pageSize: 4,
        settled: false,
        anchor: {kind: 'permalink', index: 1, id: 'center'},
      },
      {
        ...complete,
        singleRow: 'center',
        mainRows: ['before', 'first', 'sentinel'],
        afterRows: ['after', 'sentinel'],
      },
    );
    expect(rows.firstRowIndex).toBe(-1);
    expect(rows.rowsLength).toBe(4);
    expect([-2, -1, 0, 1, 2, 3].map(i => rows.rowAt(i))).toEqual([
      undefined,
      'first',
      'before',
      'center',
      'after',
      undefined,
    ]);
    expect(rows.atStart).toBe(false);
    expect(rows.atEnd).toBe(false);
  });

  test('a lone permalink retains the existing empty-window semantics', () => {
    const rows = assembleRows(
      {
        pageSize: 4,
        settled: false,
        anchor: {kind: 'permalink', index: 1, id: 'only'},
      },
      {...complete, singleRow: 'only', mainRows: [], afterRows: []},
    );
    expect(rows.rowsLength).toBe(1);
    expect(rows.rowsEmpty).toBe(true);
    expect(rows.rowAt(1)).toBe('only');
    expect(rows.atStart && rows.atEnd && rows.complete).toBe(true);
  });

  test('row lookup stays lazy for mutable query arrays', () => {
    const mainRows = ['a', 'b'];
    const rows = assembleRows(
      {
        pageSize: 4,
        settled: false,
        anchor: {kind: 'backward', index: 10, startRow: 'cursor'},
      },
      {...complete, mainRows},
    );
    mainRows[0] = 'updated';
    expect(rows.rowAt(9)).toBe('updated');
  });
});
