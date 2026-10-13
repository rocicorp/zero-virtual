import {afterEach, describe, expect, test} from 'vitest';
import {relayout} from './lanes.ts';
import {assembleRows, type RowsQueryInputs} from './rows.ts';
import {VLANE_ATTR, VROW_INDEX_ATTR, VROW_KEY_ATTR} from './dom.ts';
import {ZeroVirtualizer, type VirtualizerOptions} from './virtualizer.ts';
import type {Anchor, ScrollHistoryState} from './types.ts';

type TestRow = {id: string};

/**
 * A DOM harness for masonry, after the list harness in
 * virtualizer.dom.test.ts: a happy-dom scroll container whose geometry the
 * test controls. The content wrapper holds one element per lane, side by
 * side; each lane stacks its cards from the padding-top the core sets on it,
 * with no gap. Cards have varied heights — `r${i}` is 40 to 119px — and the
 * core estimates 80.
 */
function createHarness({
  rowCount,
  lanes = 3,
  viewportHeight = 600,
  options = {},
}: {
  rowCount: number;
  lanes?: number;
  viewportHeight?: number;
  options?: Partial<VirtualizerOptions<unknown, TestRow, TestRow>>;
}) {
  const data: TestRow[] = Array.from({length: rowCount}, (_, i) => ({
    id: `r${i}`,
  }));
  const heights = new Map<string, number>();
  const heightOf = (key: string) =>
    heights.get(key) ?? 40 + ((Number(key.slice(1)) * 37) % 80);

  const scroller = document.createElement('div');
  const wrapper = document.createElement('div');
  scroller.appendChild(wrapper);
  document.body.appendChild(scroller);
  let laneEls: HTMLElement[] = [];

  const px = (v: string) => (v ? Number.parseFloat(v) : 0);
  const cardsOf = (lane: Element) => [...lane.children];
  const laneHeight = (lane: HTMLElement) =>
    px(lane.style.paddingTop) +
    cardsOf(lane).reduce(
      (sum, c) => sum + heightOf(c.getAttribute(VROW_KEY_ATTR) ?? ''),
      0,
    ) +
    px(lane.style.paddingBottom);
  const contentHeight = () =>
    px(wrapper.style.marginTop) + Math.max(0, ...laneEls.map(laneHeight));

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
  Object.defineProperty(scroller, 'scrollHeight', {get: contentHeight});
  Object.defineProperty(scroller, 'clientHeight', {
    get: () => viewportHeight,
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
  // Where the lanes start, in the viewport: the wrapper's top.
  const lanesTop = () => -scrollTop + px(wrapper.style.marginTop);
  const cardRect = (el: Element): DOMRect => {
    const lane = el.parentElement as HTMLElement;
    let top = lanesTop() + px(lane.style.paddingTop);
    for (const card of cardsOf(lane)) {
      const h = heightOf(card.getAttribute(VROW_KEY_ATTR) ?? '');
      if (card === el) return rect(top, h);
      top += h;
    }
    throw new Error('card not in its lane');
  };

  let offsetCb: ((offset: number) => void) | null = null;
  const coreOptions: VirtualizerOptions<unknown, TestRow, TestRow> = {
    estimateSize: () => 80,
    getRowKey: row => row.id,
    listContextParams: 'ctx',
    minPageSize: 60,
    lanes,
    masonry: true,
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
  };
  const core = new ZeroVirtualizer<unknown, TestRow, TestRow>(
    coreOptions,
    () => scroller,
  );
  // The lane elements rendered follow the `lanes` option, as an app's would.
  let currentLanes = lanes;
  const setOptions = (
    next: VirtualizerOptions<unknown, TestRow, TestRow>,
  ): void => {
    currentLanes = next.lanes ?? 1;
    core.setOptions(next);
  };

  const deliverScroll = () => {
    if (scrollPending) {
      scrollPending = false;
      offsetCb?.(scrollTop);
    }
  };

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
    return dir === 'forward'
      ? data.slice(startIdx + 1, startIdx + 1 + limit)
      : data.slice(Math.max(0, startIdx - limit), startIdx).reverse();
  };
  let partial: {rows: number; from: string} | null = null;
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
    const probeRow = inputs.probeID
      ? data.find(r => r.id === inputs.probeID)
      : undefined;
    let mainRows = page(
      anchor.startRow ?? null,
      anchor.kind,
      inputs.pageSize + 1,
    );
    // Zero answers a page it hasn't synced yet from what the client holds:
    // part of it, incomplete. `partialNext` plays that for one new query.
    const key = `${anchor.kind}:${anchor.startRow?.id ?? ''}`;
    const partly = partial !== null && key !== partial.from;
    if (partly) {
      mainRows = mainRows.slice(0, partial!.rows);
      partial = null;
    }
    return assembleRows<TestRow, TestRow>(inputs, {
      singleRow: probeRow,
      singleComplete: !!inputs.probeID,
      mainRows,
      mainComplete: !partly,
      afterRows: undefined,
      afterComplete: false,
    });
  };

  // Render the lanes and each item into its lane, keyed like a framework.
  const syncDOM = () => {
    const snapshot = core.getSnapshot();
    const byKey = new Map<string, Element>();
    for (const lane of laneEls) {
      for (const card of cardsOf(lane)) {
        byKey.set(card.getAttribute(VROW_KEY_ATTR) ?? '', card);
      }
    }
    const count = currentLanes;
    while (laneEls.length < count) {
      const lane = document.createElement('div');
      lane.setAttribute(VLANE_ATTR, String(laneEls.length));
      lane.getBoundingClientRect = () => rect(lanesTop(), laneHeight(lane));
      laneEls.push(lane);
    }
    laneEls = laneEls.slice(0, count);
    wrapper.replaceChildren(...laneEls);
    const next: Element[][] = laneEls.map(() => []);
    for (const item of snapshot.items) {
      const key = String(item.key);
      let el = byKey.get(key);
      if (!el) {
        el = document.createElement('div');
        const card = el;
        el.getBoundingClientRect = () => cardRect(card);
      }
      el.setAttribute(VROW_KEY_ATTR, key);
      el.setAttribute(VROW_INDEX_ATTR, String(item.index));
      next[item.lane].push(el);
    }
    laneEls.forEach((lane, l) => lane.replaceChildren(...next[l]));
  };

  const tick = () => {
    core.setRows(answerQueries(core.getQueryInputs()));
    syncDOM();
    core.attach(scroller);
    core.afterDOMUpdate();
    deliverScroll();
  };

  const queryKey = () => {
    const {anchor, pageSize, probeID} = core.getQueryInputs();
    const cursor =
      anchor.kind === 'permalink' ? anchor.id : (anchor.startRow?.id ?? '');
    return `${anchor.kind}:${anchor.index}:${cursor}:${pageSize}:${probeID ?? ''}`;
  };
  // Every item rendered in the lane it names: no placement left to render.
  const placed = () =>
    core
      .getSnapshot()
      .items.every(
        item =>
          laneEls[item.lane]?.querySelector(
            `[${VROW_KEY_ATTR}="${String(item.key)}"]`,
          ) != null,
      );
  // Settled: the queries stopped changing, their answers are in, and every
  // card is where its lane says.
  const settle = (maxTicks = 30) => {
    for (let i = 0; i < maxTicks; i++) {
      const before = queryKey();
      tick();
      if (queryKey() === before && core.getSnapshot().complete && placed()) {
        return;
      }
    }
    throw new Error('masonry did not settle');
  };

  const allCards = () => laneEls.flatMap(cardsOf);
  const keyOf = (el: Element) => el.getAttribute(VROW_KEY_ATTR) ?? '';

  return {
    core,
    coreOptions,
    setOptions,
    scroller,
    wrapper,
    tick,
    settle,
    heightOf,
    setHeight: (key: string, h: number) => heights.set(key, h),
    /** Answer the next new page query with only its first `rows` rows. */
    partialNext: (rows: number) => {
      const {anchor} = core.getQueryInputs();
      partial = {rows, from: `${anchor.kind}:${anchor.startRow?.id ?? ''}`};
    },
    userScroll: (top: number) => {
      scroller.scrollTop = top;
      deliverScroll();
    },
    lanes: () => laneEls,
    /** The rendered cards per lane, by key. */
    laneKeys: () => laneEls.map(lane => cardsOf(lane).map(keyOf)),
    /** Every card on screen and its top in the viewport. */
    onScreen: () =>
      Object.fromEntries(
        allCards()
          .map(el => [keyOf(el), el.getBoundingClientRect()] as const)
          .filter(([, r]) => r.bottom > 0 && r.top < viewportHeight)
          .map(([key, r]) => [key, r.top]),
      ),
    cardTop: (key: string) => {
      const el = allCards().find(c => keyOf(c) === key);
      if (!el) throw new Error(`card ${key} not rendered`);
      return el.getBoundingClientRect().top;
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

// The bottom of every lane, from the cards in it.
const laneBottoms = (h: ReturnType<typeof createHarness>) =>
  h.lanes().map(lane => {
    const cards = [...lane.children];
    const last = cards.at(-1);
    return last ? last.getBoundingClientRect().bottom : -Infinity;
  });

describe('masonry', () => {
  test('cards are measured, then placed in the shortest lane', () => {
    const h = harness({rowCount: 300});
    h.settle();

    // The layout is the shortest-lane layout of the real heights, not the
    // 80px estimate.
    const keys = h.core.getSnapshot().items.map(item => String(item.key));
    const expected = relayout({
      lanes: 3,
      prev: null,
      prevHeight: h.heightOf,
      keys,
      height: key => h.heightOf(String(key)),
      assigned: () => undefined,
      viewportTop: 0,
    });
    expect(h.laneKeys()).toEqual(expected.lanes);
    // And rendered that way: every item in the lane it names.
    for (const item of h.core.getSnapshot().items) {
      expect(h.laneKeys()[item.lane]).toContain(String(item.key));
    }
    expect(h.cardTop('r0')).toBe(0);
    const bottoms = laneBottoms(h);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(120);
  });

  test('paging down and back up moves no card on screen or between lanes', () => {
    const h = harness({rowCount: 1000});
    h.settle();
    const lanesOf = new Map<string, number>();
    const track = () =>
      h.laneKeys().forEach((lane, l) => {
        for (const key of lane) {
          const seen = lanesOf.get(key);
          if (seen === undefined) lanesOf.set(key, l);
          else expect(l, `lane of ${key}`).toBe(seen);
        }
      });
    track();

    let pagedAway = false;
    for (const top of [2000, 4000, 6000, 8000, 6000, 4000, 2000, 500]) {
      h.userScroll(top);
      const before = h.onScreen();
      h.settle();
      // Cards paging in can fill space on screen; none that was there moves.
      expect(h.onScreen()).toMatchObject(before);
      track();
      if (!h.laneKeys().flat().includes('r0')) pagedAway = true;
    }
    // The pages really did turn over.
    expect(pagedAway).toBe(true);
  });

  test('a card growing above the viewport moves only its lane, above it', () => {
    const h = harness({rowCount: 1000});
    h.settle();
    h.userScroll(1500);
    h.settle();
    const before = h.onScreen();
    const scrollTop = h.scroller.scrollTop;

    // A card well above the viewport doubles in height.
    const above = h
      .laneKeys()
      .flat()
      .find(key => h.cardTop(key) < -300)!;
    const lane = h.laneKeys().findIndex(keys => keys.includes(above));
    const paddingBefore = h.lanes()[lane].style.paddingTop;
    h.setHeight(above, h.heightOf(above) * 2);
    h.tick();

    expect(h.onScreen()).toEqual(before);
    expect(h.scroller.scrollTop).toBe(scrollTop);
    expect(h.lanes()[lane].style.paddingTop).not.toBe(paddingBefore);
  });

  test('a card growing on screen pushes down only the cards below it in its lane', () => {
    const h = harness({rowCount: 1000});
    h.settle();
    h.userScroll(1500);
    h.settle();
    const before = h.onScreen();
    const visible = Object.keys(before);
    const grown = visible.find(key => before[key] > 50)!;
    const lane = h.laneKeys().findIndex(keys => keys.includes(grown));
    h.setHeight(grown, h.heightOf(grown) + 30);
    h.tick();

    const after = h.onScreen();
    const laneKeys = h.laneKeys()[lane];
    for (const key of visible) {
      if (!(key in after)) continue;
      const below =
        laneKeys.includes(key) &&
        laneKeys.indexOf(key) > laneKeys.indexOf(grown);
      expect(after[key], key).toBe(before[key] + (below ? 30 : 0));
    }
  });

  test('opened at a permalink, the target lands on top and paging up moves nothing on screen', () => {
    const h = harness({rowCount: 1000, options: {permalinkID: 'r500'}});
    h.settle();
    expect(h.cardTop('r500')).toBe(0);

    let start = false;
    for (let i = 0; i < 40 && !start; i++) {
      h.userScroll(Math.max(1, h.scroller.scrollTop - 400));
      const before = h.onScreen();
      h.settle();
      expect(h.onScreen()).toEqual(before);
      start = h.laneKeys().flat().includes('r0');
    }
    expect(start).toBe(true);
  });

  test('a restore puts every lane back where it was', () => {
    const states: ScrollHistoryState<TestRow>[] = [];
    const h = harness({
      rowCount: 1000,
      options: {onScrollStateChange: s => states.push(s)},
    });
    h.settle();
    h.userScroll(3000);
    h.settle();
    const saved = states.at(-1)!;
    expect(saved.laneCards).toHaveLength(3);
    const before = h.onScreen();

    // Somewhere else entirely, then back.
    h.core.scrollToItem('r900', {align: 'start'});
    h.settle();
    expect(h.onScreen()).not.toEqual(before);
    h.setOptions({...h.coreOptions, scrollState: saved});
    h.settle();

    expect(h.onScreen()).toEqual(before);
  });

  test('a restore lands where it was saved after a partial first answer', () => {
    const states: ScrollHistoryState<TestRow>[] = [];
    const h = harness({
      rowCount: 1000,
      options: {onScrollStateChange: s => states.push(s)},
    });
    h.settle();
    h.userScroll(3000);
    h.settle();
    const saved = states.at(-1)!;
    const before = h.onScreen();
    h.core.scrollToItem('r900', {align: 'start'});
    h.settle();

    // The restored window first comes back with only its first rows, none of
    // them the cards the restore pins. Laid out on their own, they must not
    // move where the restore lands.
    h.partialNext(20);
    h.setOptions({...h.coreOptions, scrollState: saved});
    h.settle();

    expect(h.onScreen()).toEqual(before);
    expect(h.scroller.scrollTop).toBe(saved.scrollTop);
  });

  test('a reload restores every card on screen to its lane and place', () => {
    const states: ScrollHistoryState<TestRow>[] = [];
    const before = harness({
      rowCount: 1000,
      options: {onScrollStateChange: s => states.push(s)},
    });
    before.settle();
    before.userScroll(3000);
    before.settle();
    const saved = states.at(-1)!;
    const lanesOf = (h: ReturnType<typeof createHarness>) =>
      Object.fromEntries(
        Object.keys(h.onScreen()).map(key => [
          key,
          h.laneKeys().findIndex(lane => lane.includes(key)),
        ]),
      );
    const screen = before.onScreen();
    const lanes = lanesOf(before);

    // A new virtualizer, nothing cached: only what the state carries.
    const after = harness({rowCount: 1000, options: {scrollState: saved}});
    after.settle();

    expect(after.onScreen()).toEqual(screen);
    expect(lanesOf(after)).toEqual(lanes);
  });

  test('switching to masonry switches native anchoring off', () => {
    const h = harness({
      rowCount: 300,
      options: {masonry: false, anchoring: 'native'},
    });
    h.settle();
    expect(h.scroller.style.overflowAnchor).toBe('auto');

    h.setOptions({...h.coreOptions, masonry: true});
    h.settle();
    expect(h.scroller.style.overflowAnchor).toBe('none');
  });

  test('a new lane count keeps the first card on screen where it is', () => {
    const h = harness({rowCount: 1000});
    h.settle();
    h.userScroll(2000);
    h.settle();
    // The first card in the list that reaches into the viewport, partly
    // above its top or not.
    const [key, top] = Object.entries(h.onScreen()).sort(
      (a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)),
    )[0];

    h.setOptions({...h.coreOptions, lanes: 4});
    h.settle();

    expect(h.lanes()).toHaveLength(4);
    expect(h.cardTop(key)).toBe(top);
  });
});
