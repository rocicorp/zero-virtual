import {createRoot, createSignal, type Accessor} from 'solid-js';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {RowsQueryInputs, RowsSnapshot} from '../core/rows.ts';
import {observeElementOffset, observeElementRect} from '../core/scroll.ts';
import {
  createZeroVirtualizer,
  type CreateZeroVirtualizerOptions,
} from './create-zero-virtualizer.ts';

// Mock the query-staging layer (the solid twin of the React test mocking
// use-rows.ts): the wrapper's reactive wiring runs for real against a
// controllable rows accessor.
const rowsMock = vi.hoisted(() => ({
  accessor: null as Accessor<RowsSnapshot<unknown>> | null,
  capturedInputs: null as Accessor<RowsQueryInputs<unknown>> | null,
}));

vi.mock('./create-rows.ts', () => ({
  createRows: (args: {inputs: Accessor<RowsQueryInputs<unknown>>}) => {
    rowsMock.capturedInputs = args.inputs;
    return () => rowsMock.accessor!();
  },
}));

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
    permalinkRow: undefined,
    ...overrides,
  };
}

const EST = 48;

function makeOptions(
  el: HTMLElement,
): CreateZeroVirtualizerOptions<unknown, unknown, unknown> {
  return {
    estimateSize: () => EST,
    getRowKey: row => (row as {id: string}).id,
    listContextParams: {},
    getScrollElement: () => el,
    // Never reached — createRows is mocked.
    getPageQuery: () => ({query: null as never}),
    getSingleQuery: () => ({query: null as never}),
    toStartRow: row => row,
  };
}

beforeEach(() => {
  rowsMock.accessor = null;
  rowsMock.capturedInputs = null;
});

describe('createZeroVirtualizer (solid wrapper wiring)', () => {
  test('renders a snapshot and reacts to row updates', () => {
    const el = document.createElement('div');
    const rowsData = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const [rows, setRows] = createSignal(
      makeRows({
        rowsLength: 3,
        complete: true,
        rowsEmpty: false,
        atStart: true,
        atEnd: true,
        firstRowIndex: 0,
        rowAt: i => rowsData[i],
      }),
    );
    rowsMock.accessor = rows;

    createRoot(dispose => {
      const snap = createZeroVirtualizer(() => makeOptions(el));

      expect(snap().items.map(it => it.key)).toEqual(['a', 'b', 'c']);
      expect(snap().total).toBe(3); // atStart && atEnd → exact
      expect(snap().spaceBefore).toBe(0);
      expect(snap().spaceAfter).toBe(0);

      // New rows flow through the reactive graph into a fresh snapshot.
      const more = [...rowsData, {id: 'd'}];
      setRows(
        makeRows({
          rowsLength: 4,
          complete: true,
          rowsEmpty: false,
          atStart: true,
          atEnd: false,
          firstRowIndex: 0,
          rowAt: i => more[i],
        }),
      );
      expect(snap().items).toHaveLength(4);
      expect(snap().total).toBeUndefined(); // end no longer reached
      // The estimate is a high-water mark of the discovered extent — it never
      // projects past the loaded rows, so the bottom padding stays collapsed.
      expect(snap().spaceAfter).toBe(0);
      dispose();
    });
  });

  test('items keep their instance per row key across row updates', () => {
    const el = document.createElement('div');
    const rowsData = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const [rows, setRows] = createSignal(
      makeRows({
        rowsLength: 3,
        complete: true,
        rowsEmpty: false,
        atStart: true,
        atEnd: true,
        firstRowIndex: 0,
        rowAt: i => rowsData[i],
      }),
    );
    rowsMock.accessor = rows;

    createRoot(dispose => {
      const snap = createZeroVirtualizer(() => makeOptions(el));
      const first = snap().items[0];
      expect(first.key).toBe('a');

      // A new rows snapshot makes the core rebuild every VirtualRow wrapper,
      // but the keyed store projection must keep the instance for 'a' — this
      // is what lets a plain <For> preserve row DOM across paging.
      const more = [...rowsData, {id: 'd'}];
      setRows(
        makeRows({
          rowsLength: 4,
          complete: true,
          rowsEmpty: false,
          atStart: true,
          atEnd: false,
          firstRowIndex: 0,
          rowAt: i => more[i],
        }),
      );
      expect(snap().items).toHaveLength(4);
      expect(snap().items[0]).toBe(first);
      dispose();
    });
  });

  test('feeds live query inputs to the rows layer', () => {
    const el = document.createElement('div');
    const [rows] = createSignal(makeRows({}));
    rowsMock.accessor = rows;

    createRoot(dispose => {
      createZeroVirtualizer(() => makeOptions(el));
      const inputs = rowsMock.capturedInputs!;
      expect(inputs().anchor).toEqual({
        index: 0,
        kind: 'forward',
        startRow: undefined,
      });
      expect(inputs().pageSize).toBeGreaterThanOrEqual(100);
      expect(inputs().settled).toBe(false);
      dispose();
    });
  });

  test('result exposes the resolved wiring with stable identity', () => {
    const el = document.createElement('div');
    const rowsData = [{id: 'a'}];
    const [rows, setRows] = createSignal(makeRows({}));
    rowsMock.accessor = rows;

    createRoot(dispose => {
      const getScrollElement = () => el;
      const snap = createZeroVirtualizer(() => ({
        ...makeOptions(el),
        getScrollElement,
      }));

      expect(snap().options.getScrollElement).toBe(getScrollElement);
      expect(snap().options.observeElementRect).toBe(observeElementRect);
      expect(snap().options.observeElementOffset).toBe(observeElementOffset);
      // TanStack-style: the resolved current scrolling element.
      expect(snap().scrollElement).toBe(el);

      // A content change produces a fresh snapshot but must not churn the
      // options bag (stick-to-bottom keys its controller on it).
      const before = snap().options;
      setRows(
        makeRows({
          rowsLength: 1,
          complete: true,
          rowsEmpty: false,
          atStart: true,
          atEnd: true,
          firstRowIndex: 0,
          rowAt: i => rowsData[i],
        }),
      );
      expect(snap().items).toHaveLength(1);
      expect(snap().options).toBe(before);
      dispose();
    });
  });

  test('permalink option shapes the initial query inputs', () => {
    const el = document.createElement('div');
    const [rows] = createSignal(makeRows({}));
    rowsMock.accessor = rows;

    createRoot(dispose => {
      createZeroVirtualizer(() => ({
        ...makeOptions(el),
        permalinkID: 'row-42',
      }));
      expect(rowsMock.capturedInputs!().anchor).toEqual({
        index: 1,
        kind: 'permalink',
        id: 'row-42',
      });
      dispose();
    });
  });
});
