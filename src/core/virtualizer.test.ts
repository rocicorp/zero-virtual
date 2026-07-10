import {describe, expect, test, vi} from 'vitest';
import type {RowsSnapshot} from './rows.ts';
import {observeElementOffset, observeElementRect} from './scroll.ts';
import {ZeroVirtualizer, type VirtualizerOptions} from './virtualizer.ts';

const EST = 48;

function makeRows(
  overrides: Partial<RowsSnapshot<unknown>>,
): RowsSnapshot<unknown> {
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

function makeOptions(
  overrides: Partial<VirtualizerOptions<unknown, unknown, unknown>> = {},
): VirtualizerOptions<unknown, unknown, unknown> {
  return {
    estimateSize: () => EST,
    getRowKey: row => (row as {id: string}).id,
    listContextParams: {},
    observeElementRect,
    observeElementOffset,
    ...overrides,
  };
}

function makeVirtualizer(
  rows: Partial<RowsSnapshot<unknown>>,
  options: Partial<VirtualizerOptions<unknown, unknown, unknown>> = {},
) {
  const v = new ZeroVirtualizer(makeOptions(options));
  v.setRows(makeRows(rows));
  return v;
}

// Rows are rendered in flow inside a content wrapper padded by `spaceBefore`
// (top) and `spaceAfter` (bottom); there is no virtual "count". These cases
// pin down the derived outputs — the same table the React hook test used, now
// exercised directly against the framework-free core (which also covers
// Solid).
describe('ZeroVirtualizer snapshot — items, space and total', () => {
  test.for([
    {
      name: 'empty, loading (no rows yet)',
      rows: {
        rowsLength: 0,
        complete: false,
        atStart: false,
        atEnd: false,
        firstRowIndex: 0,
      },
      expectedItems: 0,
      expectedSpaceBefore: 0,
      expectedTotal: undefined,
    },
    {
      name: 'empty, complete',
      rows: {
        rowsLength: 0,
        complete: true,
        rowsEmpty: true,
        atStart: true,
        atEnd: true,
        firstRowIndex: 0,
      },
      expectedItems: 0,
      expectedSpaceBefore: 0,
      expectedSpaceAfter: 0,
      expectedTotal: 0,
    },
    {
      name: 'loading from top, some rows',
      rows: {
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      },
      expectedItems: 20,
      expectedSpaceBefore: 0, // atStart
      expectedTotal: undefined,
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
      expectedItems: 20,
      expectedSpaceBefore: 0,
      expectedSpaceAfter: 0,
      expectedTotal: 20,
    },
    {
      name: 'loading at end, rows above (firstRowIndex>0)',
      rows: {
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: false,
        atEnd: true,
        firstRowIndex: 5,
      },
      expectedItems: 20,
      expectedSpaceBefore: 5 * EST, // 5 estimated rows above
      expectedSpaceAfter: 0, // atEnd
      expectedTotal: undefined,
    },
    {
      name: 'complete in middle (firstRowIndex>0)',
      rows: {
        rowsLength: 50,
        complete: true,
        rowsEmpty: false,
        atStart: false,
        atEnd: false,
        firstRowIndex: 10,
      },
      expectedItems: 50,
      expectedSpaceBefore: 10 * EST,
      expectedTotal: undefined,
    },
  ])(
    '$name',
    ({
      rows,
      expectedItems,
      expectedSpaceBefore,
      expectedSpaceAfter,
      expectedTotal,
    }) => {
      const snapshot = makeVirtualizer(rows).getSnapshot();

      expect(snapshot.items).toHaveLength(expectedItems);
      expect(snapshot.total).toBe(expectedTotal);
      if (expectedSpaceBefore !== undefined) {
        expect(snapshot.spaceBefore).toBe(expectedSpaceBefore);
      }
      if (expectedSpaceAfter !== undefined) {
        expect(snapshot.spaceAfter).toBe(expectedSpaceAfter);
      }
    },
  );

  test('items carry the correct index and row', () => {
    const rowsData = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const snapshot = makeVirtualizer({
      rowsLength: 3,
      complete: true,
      rowsEmpty: false,
      atStart: false,
      atEnd: false,
      firstRowIndex: 7,
      rowAt: (i: number) => rowsData[i - 7],
    }).getSnapshot();

    expect(snapshot.items.map(it => it.index)).toEqual([7, 8, 9]);
    expect(snapshot.items.map(it => it.key)).toEqual(['a', 'b', 'c']);
    expect(snapshot.items[0].row).toEqual({id: 'a'});
  });

  test('explicit count overrides estimated total', () => {
    const snapshot = makeVirtualizer(
      {
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      },
      {count: 42},
    ).getSnapshot();

    expect(snapshot.estimatedTotal).toBe(42);
    expect(snapshot.total).toBe(42);
    expect(snapshot.rowsEmpty).toBe(false);
  });

  test('explicit zero count reports empty list', () => {
    const snapshot = makeVirtualizer(
      {
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      },
      {count: 0},
    ).getSnapshot();

    expect(snapshot.estimatedTotal).toBe(0);
    expect(snapshot.total).toBe(0);
    expect(snapshot.rowsEmpty).toBe(true);
  });
});

describe('ZeroVirtualizer wrapper contract', () => {
  test('snapshot identity is cached until state changes', () => {
    const v = makeVirtualizer({
      rowsLength: 3,
      complete: true,
      rowsEmpty: false,
      atStart: true,
      atEnd: true,
      firstRowIndex: 0,
    });
    const a = v.getSnapshot();
    expect(v.getSnapshot()).toBe(a);
    v.setRows(
      makeRows({
        rowsLength: 4,
        complete: true,
        rowsEmpty: false,
        atStart: true,
        atEnd: true,
        firstRowIndex: 0,
      }),
    );
    expect(v.getSnapshot()).not.toBe(a);
  });

  test('setRows/setOptions are silent; afterDOMUpdate notifies on transitions', () => {
    const v = new ZeroVirtualizer(makeOptions());
    const listener = vi.fn();
    v.subscribe(listener);

    // Staging alone never notifies (render-safe).
    v.setRows(
      makeRows({
        rowsLength: 10,
        complete: true,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      }),
    );
    v.setOptions(makeOptions());
    expect(listener).not.toHaveBeenCalled();

    // afterDOMUpdate applies the reached-start latch + estimate bump → notify.
    v.afterDOMUpdate();
    expect(listener).toHaveBeenCalled();
    expect(v.getQueryInputs().anchor).toEqual({
      index: 0,
      kind: 'forward',
      startRow: undefined,
    });
  });

  test('warns once when listContextParams churns identity without content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const v = new ZeroVirtualizer(
        makeOptions({listContextParams: {sort: 'a'}}),
      );

      // A real context change (different content) never warns.
      v.setOptions(makeOptions({listContextParams: {sort: 'b'}}));
      v.afterDOMUpdate();
      expect(warn).not.toHaveBeenCalled();

      // The un-memoized inline-literal bug: fresh identity, same content —
      // warn once, not per commit.
      v.setOptions(makeOptions({listContextParams: {sort: 'b'}}));
      v.afterDOMUpdate();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/listContextParams/);

      v.setOptions(makeOptions({listContextParams: {sort: 'b'}}));
      v.afterDOMUpdate();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('identity-churn warning is best-effort for non-serializable params', () => {
    const circularA: {self?: unknown} = {};
    circularA.self = circularA;
    const circularB: {self?: unknown} = {};
    circularB.self = circularB;

    const v = new ZeroVirtualizer(makeOptions({listContextParams: circularA}));
    v.setOptions(makeOptions({listContextParams: circularB}));
    // JSON.stringify throws on circular params; the diagnostic must not
    // break the context-reset path.
    expect(() => v.afterDOMUpdate()).not.toThrow();
  });

  test('query inputs fall back to the new context after a context change', () => {
    const ctxA = {sort: 'a'};
    const v = new ZeroVirtualizer(makeOptions({listContextParams: ctxA}));
    expect(v.getQueryInputs().anchor.kind).toBe('forward');

    // New context: queries must immediately target it (top anchor), even
    // before afterDOMUpdate commits the reset.
    v.setOptions(makeOptions({listContextParams: {sort: 'b'}}));
    expect(v.getQueryInputs().anchor).toEqual({
      index: 0,
      kind: 'forward',
      startRow: undefined,
    });

    // A permalink wins as the fallback anchor.
    v.setOptions(
      makeOptions({listContextParams: {sort: 'c'}, permalinkID: 'row-9'}),
    );
    expect(v.getQueryInputs().anchor).toEqual({
      index: 1,
      kind: 'permalink',
      id: 'row-9',
    });
  });
});
