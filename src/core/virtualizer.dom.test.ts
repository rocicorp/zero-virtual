import {afterEach, describe, expect, test} from 'vitest';
import {assembleRows, type RowsQueryInputs} from './rows.ts';
import {VROW_INDEX_ATTR, VROW_KEY_ATTR} from './dom.ts';
import {ZeroVirtualizer, type VirtualizerOptions} from './virtualizer.ts';
import type {Anchor} from './types.ts';

type TestRow = {id: string};

/**
 * A DOM-attached harness for the imperative side of the core, which the
 * existing unit tests never reach (they all run element-less). It gives the
 * virtualizer a real (happy-dom) scroll container whose geometry the test
 * controls:
 *
 * - `getBoundingClientRect` on the scroller and each row is stubbed from a
 *   layout model (wrapper padding + margin + cumulative row heights −
 *   scrollTop), so visible-row detection, anchoring measurement, and paging
 *   evaluation all see consistent positions.
 * - `scrollTop` is an accessor with browser-style clamping; writes queue a
 *   scroll event that `deliverScroll` hands to the injected offset observer,
 *   mirroring the browser's async scroll event after a programmatic write.
 * - Queries are answered synchronously from an in-memory dataset through the
 *   real `assembleRows`, so the windowing math (including the backward
 *   branch) is exercised, not mocked.
 *
 * `tick()` plays one framework commit: answer the current query inputs, sync
 * the row DOM to the snapshot, run attach + afterDOMUpdate, then deliver any
 * scroll event the core's own writes produced. `settle()` ticks until the
 * anchor stops moving (paging cascades resolve in a few ticks).
 */
function createHarness({
  rowCount,
  rowHeight = 20,
  viewportHeight = 400,
  options = {},
}: {
  rowCount: number;
  rowHeight?: number;
  viewportHeight?: number;
  options?: Partial<VirtualizerOptions<unknown, TestRow, TestRow>>;
}) {
  const data: TestRow[] = Array.from({length: rowCount}, (_, i) => ({
    id: `r${i}`,
  }));
  const heights = new Map<string, number>();
  const heightOf = (key: string) => heights.get(key) ?? rowHeight;

  const scroller = document.createElement('div');
  const wrapper = document.createElement('div');
  scroller.appendChild(wrapper);
  document.body.appendChild(scroller);

  const paddingPx = (v: string) => (v ? Number.parseFloat(v) : 0);
  const contentHeight = () =>
    paddingPx(wrapper.style.paddingTop) +
    paddingPx(wrapper.style.marginTop) +
    [...wrapper.children].reduce(
      (sum, c) => sum + heightOf(c.getAttribute(VROW_KEY_ATTR) ?? ''),
      0,
    ) +
    paddingPx(wrapper.style.paddingBottom);

  // scrollTop with browser-style clamping; writes queue a scroll event.
  let scrollTop = 0;
  let scrollPending = false;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set(v: number) {
      const next = Math.max(0, Math.min(v, contentHeight() - viewportHeight));
      if (next !== scrollTop) {
        scrollTop = next;
        scrollPending = true;
      }
    },
  });

  const rect = (top: number, height: number): DOMRect =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  scroller.getBoundingClientRect = () => rect(0, viewportHeight);

  const rowRect = (el: Element): DOMRect => {
    let top =
      -scrollTop +
      paddingPx(wrapper.style.paddingTop) +
      paddingPx(wrapper.style.marginTop);
    for (const child of wrapper.children) {
      const h = heightOf(child.getAttribute(VROW_KEY_ATTR) ?? '');
      if (child === el) return rect(top, h);
      top += h;
    }
    throw new Error('row not in wrapper');
  };

  // The injected observers: rect reports immediately (like a ResizeObserver's
  // initial measurement); the offset callback is delivered by deliverScroll.
  let offsetCb: ((offset: number) => void) | null = null;
  const core = new ZeroVirtualizer<unknown, TestRow, TestRow>({
    estimateSize: () => rowHeight,
    getRowKey: row => row.id,
    listContextParams: 'ctx',
    anchoring: 'native',
    observeElementRect: (_instance, cb) => {
      cb({width: 300, height: viewportHeight});
    },
    observeElementOffset: (_instance, cb) => {
      offsetCb = cb;
      return () => {
        offsetCb = null;
      };
    },
    ...options,
  });

  const deliverScroll = () => {
    if (scrollPending) {
      scrollPending = false;
      offsetCb?.(scrollTop);
    }
  };

  // Answer the staged queries from the dataset, Zero-demo style: exclusive
  // .start cursor, backward pages returned closest-row-first.
  const page = (
    start: TestRow | null,
    dir: 'forward' | 'backward',
    limit: number,
  ) => {
    const startIdx = start
      ? data.findIndex(r => r.id === start.id)
      : dir === 'forward'
        ? -1
        : data.length;
    if (dir === 'forward') {
      return data.slice(startIdx + 1, startIdx + 1 + limit);
    }
    return data.slice(Math.max(0, startIdx - limit), startIdx).reverse();
  };

  const answerQueries = (inputs: RowsQueryInputs<TestRow>) => {
    const anchor: Anchor<TestRow> = inputs.anchor;
    if (anchor.kind === 'permalink') {
      const singleRow = data.find(r => r.id === anchor.id);
      return assembleRows<TestRow, TestRow>(inputs, {
        singleRow,
        singleComplete: true,
        mainRows: singleRow
          ? page(singleRow, 'backward', inputs.pageSize / 2 + 1)
          : undefined,
        mainComplete: true,
        afterRows: singleRow
          ? page(singleRow, 'forward', inputs.pageSize / 2)
          : undefined,
        afterComplete: true,
      });
    }
    return assembleRows<TestRow, TestRow>(inputs, {
      singleRow: undefined,
      singleComplete: false,
      mainRows: page(anchor.startRow ?? null, anchor.kind, inputs.pageSize + 1),
      mainComplete: true,
      afterRows: undefined,
      afterComplete: false,
    });
  };

  // Sync the row DOM to the snapshot, keyed like a framework would render.
  const syncDOM = () => {
    const snapshot = core.getSnapshot();
    const byKey = new Map<string, Element>();
    for (const child of wrapper.children) {
      byKey.set(child.getAttribute(VROW_KEY_ATTR) ?? '', child);
    }
    const next: Element[] = snapshot.items.map(item => {
      const key = String(item.key);
      let el = byKey.get(key);
      if (!el) {
        el = document.createElement('div');
        el.getBoundingClientRect = () => rowRect(el as Element);
      }
      el.setAttribute(VROW_KEY_ATTR, key);
      el.setAttribute(VROW_INDEX_ATTR, String(item.index));
      return el;
    });
    wrapper.replaceChildren(...next);
    wrapper.style.paddingTop = `${snapshot.spaceBefore}px`;
    wrapper.style.paddingBottom = `${snapshot.spaceAfter}px`;
  };

  const tick = () => {
    core.setRows(answerQueries(core.getQueryInputs()));
    syncDOM();
    core.attach(scroller);
    core.afterDOMUpdate();
    // The browser fires the scroll event for any scrollTop write the update
    // performed (compensation, restore); this is what clears the
    // programmatic-scroll flag.
    deliverScroll();
  };

  const settle = (maxTicks = 20) => {
    for (let i = 0; i < maxTicks; i++) {
      const before = JSON.stringify(core.getQueryInputs().anchor);
      tick();
      if (JSON.stringify(core.getQueryInputs().anchor) === before) return;
    }
    throw new Error('paging did not settle');
  };

  const userScroll = (px: number) => {
    scroller.scrollTop = px;
    deliverScroll();
  };

  const visibleIndexes = () =>
    [...wrapper.children]
      .filter(c => {
        const r = rowRect(c);
        return r.bottom > 0 && r.top < viewportHeight;
      })
      .map(c => Number(c.getAttribute(VROW_INDEX_ATTR)));

  return {
    core,
    scroller,
    wrapper,
    tick,
    settle,
    userScroll,
    deliverScroll,
    visibleIndexes,
    setRowHeight: (key: string, px: number) => heights.set(key, px),
    rowTop: (key: string) => {
      const el = wrapper.querySelector(`[${VROW_KEY_ATTR}="${key}"]`);
      if (!el) throw new Error(`row ${key} not rendered`);
      return rowRect(el).top;
    },
    destroy: () => {
      core.detach();
      scroller.remove();
    },
  };
}

const harnesses: Array<{destroy: () => void}> = [];
function harness(...args: Parameters<typeof createHarness>) {
  const h = createHarness(...args);
  harnesses.push(h);
  return h;
}
afterEach(() => {
  while (harnesses.length) harnesses.pop()!.destroy();
});

/** [start, end] inclusive. */
const range = (start: number, end: number) =>
  Array.from({length: end - start + 1}, (_, i) => start + i);

describe('paging against a real (fake-geometry) scroll container', () => {
  test('initial load anchors at the top and fills one page', () => {
    const h = harness({rowCount: 500});
    h.settle();

    const snapshot = h.core.getSnapshot();
    expect(snapshot.items[0].index).toBe(0);
    expect(snapshot.items).toHaveLength(100);
    expect(snapshot.items[0].row).toEqual({id: 'r0'});
    expect(snapshot.spaceBefore).toBe(0);
    expect(h.visibleIndexes()).toEqual(range(0, 19));
  });

  test('scrolling near the window end advances the forward anchor', () => {
    const h = harness({rowCount: 500});
    h.settle();

    // Rows are 20px in a 400px viewport: scrollTop 1500 shows rows 75-94 of
    // the loaded 0-99 window — 5 rows from the end, within the threshold of
    // 10 (pageSize 100 / 10). Paging re-anchors forward at
    // firstVisible − 2·threshold = 55, loading the window 56-155.
    h.userScroll(1500);
    h.settle();

    const snapshot = h.core.getSnapshot();
    expect(snapshot.items[0].index).toBe(56);
    expect(snapshot.items).toHaveLength(100);
    expect(snapshot.spaceBefore).toBe(56 * 20);
    // The loaded window is contiguous and correctly labeled: item at virtual
    // index i is dataset row i.
    for (const item of snapshot.items) {
      expect(item.row).toEqual({id: `r${item.index}`});
    }
    // The viewport still shows the same rows — paging must not move content.
    expect(h.visibleIndexes()).toEqual(range(75, 94));
  });

  test('scrolling back near the window start pages backward', () => {
    const h = harness({rowCount: 500});
    h.settle();
    h.userScroll(1500);
    h.settle();
    expect(h.core.getSnapshot().items[0].index).toBe(56);

    // Scroll up until the first loaded row (56) is one row above the
    // viewport: within threshold, so the backward branch of assembleRows
    // extends the window upward. The backward anchor lands at
    // lastVisible + 2·threshold = 96 with only 96 rows before it, so the
    // window reaches the very start: rows 0-95.
    h.userScroll(1140);
    const visibleBefore = h.visibleIndexes();
    expect(visibleBefore).toEqual(range(57, 76));
    h.settle();

    const snapshot = h.core.getSnapshot();
    expect(snapshot.items[0].index).toBe(0);
    expect(snapshot.items).toHaveLength(96);
    expect(snapshot.spaceBefore).toBe(0);
    for (const item of snapshot.items) {
      expect(item.row).toEqual({id: `r${item.index}`});
    }
    // The visible rows must not move while the window grows upward.
    expect(h.visibleIndexes()).toEqual(visibleBefore);
  });

  test('a far jump into unloaded space below recovers by cascading pages', () => {
    const h = harness({rowCount: 500, options: {count: 500}});
    h.settle();
    expect(h.core.getSnapshot().spaceAfter).toBe((500 - 100) * 20);

    // Jump deep into the wrapper padding: no loaded row is visible, so the
    // edge-distance logic has nothing to react to — the recovery branch
    // cascades pages toward the viewport (100-199, 200-299, 300-399), and a
    // final backward fill near the new window's start settles on 239-338.
    h.userScroll(6000);
    h.settle();

    expect(h.visibleIndexes()).toEqual(range(300, 319));
    const snapshot = h.core.getSnapshot();
    expect(snapshot.items[0].index).toBe(239);
    expect(snapshot.items).toHaveLength(100);
    expect(snapshot.spaceBefore).toBe(239 * 20);
    expect(h.scroller.scrollTop).toBe(6000);
    for (const item of snapshot.items) {
      expect(item.row).toEqual({id: `r${item.index}`});
    }
  });

  test('a far jump back to the very top re-anchors at the start', () => {
    const h = harness({rowCount: 500, options: {count: 500}});
    h.settle();
    h.userScroll(6000);
    h.settle();
    expect(h.core.getSnapshot().items[0].index).toBe(239);

    h.userScroll(0);
    h.settle();

    const snapshot = h.core.getSnapshot();
    expect(snapshot.items[0].index).toBe(0);
    expect(snapshot.items).toHaveLength(100);
    expect(snapshot.spaceBefore).toBe(0);
    expect(h.visibleIndexes()).toEqual(range(0, 19));
  });
});

describe('manual scroll anchoring against a real (fake-geometry) container', () => {
  test('growth above the anchor row is compensated into scrollTop', () => {
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();

    // Establish an anchor mid-list: the topmost visible row (r50 at
    // scrollTop 1000) becomes the reference.
    h.userScroll(1000);
    h.settle();
    const anchorTopBefore = h.rowTop('r50');
    expect(anchorTopBefore).toBe(0);

    // An off-screen loaded row above the viewport grows by 30px (a dynamic
    // row resolving taller). The viewport must not move visually.
    h.setRowHeight('r30', 50);
    h.tick();

    expect(h.scroller.scrollTop).toBe(1030);
    expect(h.rowTop('r50')).toBe(anchorTopBefore);
  });

  test('shrinkage above the anchor row is compensated too', () => {
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();
    h.userScroll(1000);
    h.settle();

    h.setRowHeight('r30', 5); // -15px
    h.tick();

    expect(h.scroller.scrollTop).toBe(985);
    expect(h.rowTop('r50')).toBe(0);
  });

  test('growth at scroll offset 0 is revealed, not compensated away', () => {
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();
    expect(h.scroller.scrollTop).toBe(0);

    // Per the CSS scroll-anchoring spec, anchoring is suppressed at offset 0:
    // content growing at the top should be revealed (pushed into view), and
    // scrollTop must stay 0.
    h.setRowHeight('r0', 60);
    h.tick();

    expect(h.scroller.scrollTop).toBe(0);
  });

  test('growth below the anchor row does not move the viewport', () => {
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();
    h.userScroll(1000);
    h.settle();

    // Content below the reference changing size never needs compensation.
    h.setRowHeight('r80', 200);
    h.tick();

    expect(h.scroller.scrollTop).toBe(1000);
    expect(h.rowTop('r50')).toBe(0);
  });
});
