import {afterEach} from 'vitest';
import type {RowsQueryInputs, RowsSnapshot} from './rows.ts';
import type {ObserveElementOffset, ObserveElementRect} from './scroll.ts';
import type {Anchor} from './types.ts';

// What the DOM test harnesses share: a scroll container whose geometry the
// test controls, and queries answered from an in-memory dataset.

export type TestRow = {id: string; rowid?: bigint};

/** A DOMRect at `top`, `height` tall, in a 300px-wide column. */
export function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 300,
    width: 300,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A rows snapshot with nothing loaded yet, plus `overrides`. */
export function makeRows<TRow = unknown>(
  overrides: Partial<RowsSnapshot<TRow>> = {},
): RowsSnapshot<TRow> {
  return {
    anchor: {index: 0, kind: 'forward', startRow: undefined},
    pageSize: 50,
    rowAt: () => undefined,
    rowsLength: 0,
    complete: false,
    rowsEmpty: true,
    atStart: false,
    atEnd: false,
    firstRowIndex: 0,
    permalinkNotFound: false,
    lookup: null,
    ...overrides,
  };
}

/** An inline style's px length, 0 when unset. */
export const px = (value: string): number =>
  value ? Number.parseFloat(value) : 0;

/**
 * Answers page queries from `data`, Zero-demo style: an exclusive start
 * cursor, and backward pages closest-row-first.
 */
export function pager(data: readonly TestRow[]) {
  return (
    start: TestRow | null,
    dir: 'forward' | 'backward',
    limit: number,
  ): TestRow[] => {
    const startIdx = start
      ? data.findIndex(r => r.id === start.id)
      : dir === 'forward'
        ? -1
        : data.length;
    return dir === 'forward'
      ? data.slice(startIdx + 1, startIdx + 1 + limit)
      : data.slice(Math.max(0, startIdx - limit), startIdx).reverse();
  };
}

/** Where an anchor's page starts, as a string. */
export function pageKey(anchor: Anchor<TestRow>): string {
  return anchor.kind === 'permalink'
    ? `permalink:${anchor.id}`
    : `${anchor.kind}:${anchor.startRow?.id ?? ''}`;
}

/**
 * The query inputs as a string: the queries have settled when it stops
 * changing. Spelled out field by field rather than stringified, so the
 * harness imposes no serializability requirement of its own on the rows
 * under test.
 */
export function queryKey({
  anchor,
  pageSize,
  probeID,
}: RowsQueryInputs<TestRow>): string {
  return `${pageKey(anchor)}:${anchor.index}:${pageSize}:${probeID ?? ''}`;
}

/**
 * A happy-dom scroll container holding a content wrapper. `scrollTop` clamps
 * to `contentHeight()` like a browser's — on a write, and on a read once the
 * content has shrunk under it — and a change queues a scroll event, which
 * `deliverScroll` hands to the core's offset observer, as the browser's
 * async scroll event would after a write.
 */
export function createScroller(
  viewportHeight: number,
  contentHeight: () => number,
) {
  const scroller = document.createElement('div');
  const wrapper = document.createElement('div');
  scroller.appendChild(wrapper);
  document.body.appendChild(scroller);

  let scrollTop = 0;
  let scrollPending = false;
  const max = () => Math.max(0, contentHeight() - viewportHeight);
  const read = () => {
    if (scrollTop > max()) {
      scrollTop = max();
      scrollPending = true;
    }
    return scrollTop;
  };
  Object.defineProperty(scroller, 'scrollTop', {
    get: read,
    set(v: number) {
      const next = Math.max(0, Math.min(v, max()));
      if (next !== scrollTop) {
        scrollTop = next;
        scrollPending = true;
      }
    },
  });
  Object.defineProperty(scroller, 'scrollHeight', {get: contentHeight});
  Object.defineProperty(scroller, 'clientHeight', {
    get: () => viewportHeight,
  });

  // The rect reports at once, like a ResizeObserver's first measurement; the
  // offset waits for deliverScroll.
  let offsetCb: ((offset: number) => void) | null = null;
  const observeElementRect: ObserveElementRect = (_instance, cb) => {
    cb({width: 300, height: viewportHeight});
  };
  const observeElementOffset: ObserveElementOffset = (_instance, cb) => {
    offsetCb = cb;
    return () => {
      offsetCb = null;
    };
  };
  const deliverScroll = () => {
    if (scrollPending) {
      scrollPending = false;
      offsetCb?.(scrollTop);
    }
  };

  return {
    scroller,
    wrapper,
    scrollTop: read,
    observeElementRect,
    observeElementOffset,
    deliverScroll,
    userScroll: (top: number) => {
      scroller.scrollTop = top;
      deliverScroll();
    },
  };
}

/** Wraps a harness factory so what it creates is destroyed after each test. */
export function registered<A extends unknown[], T extends {destroy(): void}>(
  create: (...args: A) => T,
): (...args: A) => T {
  const live: T[] = [];
  afterEach(() => {
    while (live.length) live.pop()!.destroy();
  });
  return (...args) => {
    const h = create(...args);
    live.push(h);
    return h;
  };
}
