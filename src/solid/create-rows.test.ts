import {createRoot, createSignal, type Accessor} from 'solid-js';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {RowsQueryInputs} from '../core/rows.ts';
import {createRows} from './create-rows.ts';

// Fake @rocicorp/zero/solid: record each useQuery slot's accessors and hand
// back controllable signals, so the staging logic is exercised for real.
type Slot = {
  querySignal: Accessor<unknown>;
  setData: (v: unknown) => void;
  setDetails: (v: {type: string}) => void;
};
const slots = vi.hoisted(() => [] as Slot[]);

vi.mock('@rocicorp/zero/solid', () => ({
  useQuery: (querySignal: Accessor<unknown>) => {
    const [data, setData] = createSignal<unknown>(undefined);
    const [details, setDetails] = createSignal<{type: string}>({
      type: 'unknown',
    });
    slots.push({
      querySignal,
      setData: v => setData(() => v),
      setDetails,
    });
    return [data, details];
  },
}));

beforeEach(() => {
  slots.length = 0;
});

type Row = {id: string};
const toStartRow = (row: Row) => ({id: row.id});

function setup(inputs: Accessor<RowsQueryInputs<{id: string}>>) {
  const getPageQuery = vi.fn((opts: unknown) => ({
    query: {kind: 'page', opts} as unknown,
  }));
  const getSingleQuery = vi.fn((opts: unknown) => ({
    query: {kind: 'single', opts} as unknown,
  }));
  let rows!: ReturnType<typeof createRows<Row, {id: string}>>;
  const dispose = createRoot(d => {
    rows = createRows<Row, {id: string}>({
      inputs,
      // oxlint-disable-next-line no-explicit-any
      getPageQuery: () => getPageQuery as any,
      // oxlint-disable-next-line no-explicit-any
      getSingleQuery: () => getSingleQuery as any,
      toStartRow: () => toStartRow,
    });
    return d;
  });
  return {rows, getPageQuery, getSingleQuery, dispose};
}

describe('createRows (solid staging over the core builders)', () => {
  test('forward anchor: main query is built (accessors invoked) and rows assemble', () => {
    const [inputs] = createSignal<RowsQueryInputs<{id: string}>>({
      pageSize: 4,
      anchor: {index: 0, kind: 'forward', startRow: undefined},
      settled: false,
    });
    const {rows, getPageQuery, dispose} = setup(inputs);

    expect(slots).toHaveLength(4);
    // Slot order follows the staging order: single (1), probe (4), main (2),
    // after (3). Queries 2 and 3 wait on query 1's result; the probe depends
    // on nothing and nothing depends on it, so its position is free.
    // Slot 1 (permalink single-row) stays null for a forward anchor, as does
    // the probe slot with no probeID.
    expect(slots[0].querySignal()).toBeNull();
    expect(slots[1].querySignal()).toBeNull();
    // The main slot carries a *built* page query — i.e. the getPageQuery
    // accessor was invoked and its result invoked with staged options (not
    // passed along as a function).
    const main = slots[2].querySignal() as {kind: string; opts: unknown};
    expect(main.kind).toBe('page');
    expect(getPageQuery).toHaveBeenCalledWith({
      limit: 5, // pageSize + 1 (has-more sentinel)
      start: null,
      dir: 'forward',
      settled: false,
    });
    // The page-after slot is permalink-only.
    expect(slots[3].querySignal()).toBeNull();

    // Feed 5 rows (pageSize + 1): window is 4 rows, more below.
    slots[2].setData([{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}, {id: 'e'}]);
    slots[2].setDetails({type: 'complete'});
    const snap = rows();
    expect(snap.rowsLength).toBe(4);
    expect(snap.complete).toBe(true);
    expect(snap.atStart).toBe(true);
    expect(snap.atEnd).toBe(false);
    expect(snap.rowAt(1)).toEqual({id: 'b'});
    dispose();
  });

  test('permalink anchor: stages queries 2/3 on query 1 result', () => {
    const [inputs] = createSignal<RowsQueryInputs<{id: string}>>({
      pageSize: 4,
      anchor: {index: 1, kind: 'permalink', id: 'x'},
      settled: false,
    });
    const {rows, getSingleQuery, getPageQuery, dispose} = setup(inputs);

    // Stage 1 built from the single-row lookup; stages 2/3 wait on its result.
    const single = slots[0].querySignal() as {kind: string};
    expect(single.kind).toBe('single');
    expect(getSingleQuery).toHaveBeenCalledWith({id: 'x', settled: false});
    expect(slots[2].querySignal()).toBeNull();
    expect(slots[3].querySignal()).toBeNull();

    // The single row arrives → the before/after page queries appear, anchored
    // on the row's start data.
    slots[0].setData({id: 'x'});
    slots[0].setDetails({type: 'complete'});
    expect(slots[2].querySignal()).not.toBeNull();
    expect(slots[3].querySignal()).not.toBeNull();
    expect(getPageQuery).toHaveBeenCalledWith({
      limit: 3, // halfPageSize + 1
      start: {id: 'x'},
      dir: 'backward',
      settled: false,
    });
    expect(getPageQuery).toHaveBeenCalledWith({
      limit: 2, // halfPageSize
      start: {id: 'x'},
      dir: 'forward',
      settled: false,
    });

    slots[2].setData([{id: 'w'}]);
    slots[2].setDetails({type: 'complete'});
    slots[3].setData([{id: 'y'}]);
    slots[3].setDetails({type: 'complete'});
    const snap = rows();
    expect(snap.rowAt(1)).toEqual({id: 'x'});
    expect(snap.rowAt(0)).toEqual({id: 'w'});
    expect(snap.rowAt(2)).toEqual({id: 'y'});
    expect(snap.complete).toBe(true);
    expect(snap.firstRowIndex).toBe(0);
    dispose();
  });
});
