import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {useRows} from './use-rows.ts';
import {useStickToBottom} from './use-stick-to-edge.ts';
import {
  useZeroVirtualizer,
  useZeroWindowVirtualizer,
} from './use-zero-virtualizer.ts';
import {makeRows} from '../core/scroll-harness.ts';

vi.mock('./use-rows.ts', () => ({
  useRows: vi.fn(),
}));

const mockUseRows = vi.mocked(useRows);

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
  vi.unstubAllGlobals();
});

// The snapshot's derivations (items, space, total, count) are tested against
// the core in virtualizer.test.ts. This only checks the hook hands the core's
// snapshot through.
describe('useZeroVirtualizer - snapshot', () => {
  test('items carry the correct index and row', () => {
    const rowsData = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    mockUseRows.mockReturnValue(
      makeRows({
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
});

describe('useZeroVirtualizer - result', () => {
  test('exposes the current scrolling element', () => {
    mockUseRows.mockReturnValue(makeRows({}));

    const options = makeOptions();
    const {result} = renderHook(() => useZeroVirtualizer(options));

    expect(result.current.scrollElement).toBe(options.getScrollElement());
  });

  test('the window virtualizer scrolls the document', () => {
    mockUseRows.mockReturnValue(makeRows({}));

    const options = makeOptions();
    const {result} = renderHook(() => useZeroWindowVirtualizer(options));

    expect(result.current.scrollElement).toBe(document.scrollingElement);
  });

  test('result identity is stable across renders without content changes', () => {
    mockUseRows.mockReturnValue(makeRows({}));

    const options = makeOptions();
    const {result, rerender} = renderHook(() => useZeroVirtualizer(options));

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  test('scrollToItem identity survives a content change, so it is dep-array safe', () => {
    mockUseRows.mockReturnValue(makeRows({}));

    const options = makeOptions();
    const {result, rerender} = renderHook(() => useZeroVirtualizer(options));

    const firstResult = result.current;
    const firstScrollToItem = firstResult.scrollToItem;
    expect(typeof firstScrollToItem).toBe('function');

    // A new rows result rebuilds the result object; the callback must not
    // change with it, or every consumer's effect re-runs on every page.
    mockUseRows.mockReturnValue(makeRows({rowsLength: 3}));
    rerender();

    expect(result.current).not.toBe(firstResult);
    expect(result.current.scrollToItem).toBe(firstScrollToItem);
  });
});

describe('useStickToBottom over the virtualizer result', () => {
  test('re-pins to the bottom on content growth only while stuck', () => {
    mockUseRows.mockReturnValue(makeRows({}));

    // The re-pinning is driven by ResizeObservers on the content wrapper and
    // the scroll container; capture their callbacks to fire growth manually
    // (happy-dom never fires them itself).
    const observers: {cb: ResizeObserverCallback; targets: Element[]}[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly #entry: {cb: ResizeObserverCallback; targets: Element[]};
        constructor(cb: ResizeObserverCallback) {
          this.#entry = {cb, targets: []};
          observers.push(this.#entry);
        }
        observe(target: Element) {
          this.#entry.targets.push(target);
        }
        disconnect() {
          this.#entry.targets.length = 0;
        }
      },
    );
    const fireResize = () => {
      for (const {cb, targets} of observers) {
        if (targets.length > 0) {
          cb([], undefined as unknown as ResizeObserver);
        }
      }
    };

    const options = makeOptions();
    const scrollEl = options.getScrollElement();
    // The rows' content wrapper (found in the DOM as the first row's parent).
    const wrapper = document.createElement('div');
    const row = document.createElement('div');
    row.setAttribute('data-vrow-index', '0');
    wrapper.appendChild(row);
    scrollEl.appendChild(wrapper);
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

    renderHook(() => {
      const virtualizer = useZeroVirtualizer(options);
      useStickToBottom(virtualizer);
    });

    // Mounted parked at the bottom (scrollHeight - scrollTop - clientHeight
    // = 0) → stuck. Content growth (the wrapper resizes) re-pins.
    scrollHeight = 250;
    fireResize();
    expect(scrollTop).toBe(250);

    // Scroll away → unstuck; further growth must not yank the viewport.
    scrollTop = 50;
    scrollEl.dispatchEvent(new Event('scroll'));
    scrollHeight = 300;
    fireResize();
    expect(scrollTop).toBe(50);
  });
});
