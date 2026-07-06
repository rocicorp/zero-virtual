import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
} from '../core/scroll.ts';
import {useRows} from './use-rows.ts';
import {useStickToBottom} from './use-stick-to-edge.ts';
import {
  useZeroVirtualizer,
  useZeroWindowVirtualizer,
} from './use-zero-virtualizer.ts';

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

const EST = 48;

function makeOptions() {
  const scrollEl = document.createElement('div');
  const listContextParams = {};
  return {
    estimateSize: () => EST,
    getScrollElement: () => scrollEl,
    getRowKey: (row: unknown) => (row as {id: string}).id,
    listContextParams,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPageQuery: () => ({query: null as any}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSingleQuery: () => ({query: null as any}),
    toStartRow: (row: unknown) => row,
  } as const;
}

afterEach(() => {
  vi.clearAllMocks();
});

// Rows are rendered in flow inside a content wrapper padded by `spaceBefore`
// (top) and `spaceAfter` (bottom); there is no virtual "count". These cases
// pin down the derived outputs: how many rows to render, the space estimates,
// and `total`.
describe('useZeroVirtualizer - items, space and total', () => {
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
      mockUseRows.mockReturnValue(makeUseRowsResult(rows));

      // `options` must be stable across renders (a fresh `listContextParams`
      // each render would make the hook think the context keeps changing).
      const options = makeOptions();
      const {result} = renderHook(() => useZeroVirtualizer(options));

      expect(result.current.items).toHaveLength(expectedItems);
      expect(result.current.total).toBe(expectedTotal);
      if (expectedSpaceBefore !== undefined) {
        expect(result.current.spaceBefore).toBe(expectedSpaceBefore);
      }
      if (expectedSpaceAfter !== undefined) {
        expect(result.current.spaceAfter).toBe(expectedSpaceAfter);
      }
    },
  );

  test('items carry the correct index and row', () => {
    const rowsData = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    mockUseRows.mockReturnValue(
      makeUseRowsResult({
        rowsLength: 3,
        complete: true,
        rowsEmpty: false,
        atStart: false,
        atEnd: false,
        firstRowIndex: 7,
        rowAt: (i: number) => rowsData[i - 7],
      }),
    );

    const options = makeOptions();
    const {result} = renderHook(() => useZeroVirtualizer(options));

    expect(result.current.items.map(it => it.index)).toEqual([7, 8, 9]);
    expect(result.current.items.map(it => it.key)).toEqual(['a', 'b', 'c']);
    expect(result.current.items[0].row).toEqual({id: 'a'});
  });

  test('explicit count overrides estimated total', () => {
    mockUseRows.mockReturnValue(
      makeUseRowsResult({
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      }),
    );

    const options = {...makeOptions(), count: 42};
    const {result} = renderHook(() => useZeroVirtualizer(options));

    expect(result.current.estimatedTotal).toBe(42);
    expect(result.current.total).toBe(42);
    expect(result.current.rowsEmpty).toBe(false);
  });

  test('explicit zero count reports empty list', () => {
    mockUseRows.mockReturnValue(
      makeUseRowsResult({
        rowsLength: 20,
        complete: false,
        rowsEmpty: false,
        atStart: true,
        atEnd: false,
        firstRowIndex: 0,
      }),
    );

    const options = {...makeOptions(), count: 0};
    const {result} = renderHook(() => useZeroVirtualizer(options));

    expect(result.current.estimatedTotal).toBe(0);
    expect(result.current.total).toBe(0);
    expect(result.current.rowsEmpty).toBe(true);
  });
});

// The result echoes the resolved wiring (TanStack-style `options`) so helpers
// like useStickToBottom can be handed the virtualizer instead of the scroll
// element getter and observers separately.
describe('useZeroVirtualizer - result options', () => {
  test('exposes the scroll element getter and resolved observers', () => {
    mockUseRows.mockReturnValue(makeUseRowsResult({}));

    const options = makeOptions();
    const {result} = renderHook(() => useZeroVirtualizer(options));

    expect(result.current.options.getScrollElement).toBe(
      options.getScrollElement,
    );
    expect(result.current.options.observeElementRect).toBe(observeElementRect);
    expect(result.current.options.observeElementOffset).toBe(
      observeElementOffset,
    );
    // TanStack-style: the resolved current scrolling element.
    expect(result.current.scrollElement).toBe(options.getScrollElement());
  });

  test('window virtualizer resolves the window scroll observers', () => {
    mockUseRows.mockReturnValue(makeUseRowsResult({}));

    const options = makeOptions();
    const {result} = renderHook(() => useZeroWindowVirtualizer(options));

    expect(result.current.options.observeElementOffset).toBe(
      observeWindowOffset,
    );
    expect(result.current.scrollElement).toBe(document.scrollingElement);
  });

  test('individual observers can be overridden, TanStack style', () => {
    mockUseRows.mockReturnValue(makeUseRowsResult({}));

    const customObserveOffset = () => () => {};
    const options = {
      ...makeOptions(),
      observeElementOffset: customObserveOffset,
    };
    const {result} = renderHook(() => useZeroVirtualizer(options));

    expect(result.current.options.observeElementOffset).toBe(
      customObserveOffset,
    );
    expect(result.current.options.observeElementRect).toBe(observeElementRect);
  });

  test('result identity is stable across renders without content changes', () => {
    mockUseRows.mockReturnValue(makeUseRowsResult({}));

    const options = makeOptions();
    const {result, rerender} = renderHook(() => useZeroVirtualizer(options));

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.options).toBe(first.options);
  });
});

describe('useStickToBottom over the virtualizer result', () => {
  test('re-pins to the bottom on content growth only while stuck', () => {
    mockUseRows.mockReturnValue(makeUseRowsResult({}));

    const options = makeOptions();
    const scrollEl = options.getScrollElement();
    let scrollTop = 0;
    let scrollHeight = 100;
    Object.defineProperties(scrollEl, {
      scrollTop: {
        get: () => scrollTop,
        set: (v: number) => {
          scrollTop = v;
        },
      },
      scrollHeight: {get: () => scrollHeight},
      clientHeight: {get: () => 100},
    });

    const {rerender} = renderHook(
      ({dep}: {dep: number}) => {
        const virtualizer = useZeroVirtualizer(options);
        useStickToBottom(virtualizer, {}, [dep]);
      },
      {initialProps: {dep: 0}},
    );

    // Mounted parked at the bottom (scrollHeight - scrollTop - clientHeight
    // = 0) → stuck. Content growth re-pins.
    scrollHeight = 250;
    rerender({dep: 1});
    expect(scrollTop).toBe(250);

    // Scroll away → unstuck; further growth must not yank the viewport.
    scrollTop = 50;
    scrollEl.dispatchEvent(new Event('scroll'));
    scrollHeight = 300;
    rerender({dep: 2});
    expect(scrollTop).toBe(50);
  });
});
