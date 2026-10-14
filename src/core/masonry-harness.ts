import {afterEach} from 'vitest';
import {assembleRows, type RowsQueryInputs} from './rows.ts';
import {VLANE_ATTR, VROW_INDEX_ATTR, VROW_KEY_ATTR} from './dom.ts';
import {masonryLayout} from './masonry.ts';
import {ZeroVirtualizer, type VirtualizerOptions} from './virtualizer.ts';
import type {Anchor} from './types.ts';

type TestRow = {id: string};

/**
 * A DOM harness for masonry, after the list harness in
 * virtualizer.dom.test.ts: a happy-dom scroll container whose geometry the
 * test controls. The content wrapper holds one element per lane, side by
 * side; each lane stacks its cards from the padding-top the core sets on it,
 * `gap` px apart. Cards have varied heights — `r${i}` is 40 to 119px — and
 * the core estimates 80.
 */
export function createHarness({
  rowCount,
  lanes = 3,
  viewportHeight = 600,
  gap = 0,
  options = {},
}: {
  rowCount: number;
  lanes?: number;
  viewportHeight?: number;
  /** The lanes' row gap, which goes between cards only. */
  gap?: number;
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
      (sum, c, i) =>
        sum + (i > 0 ? gap : 0) + heightOf(c.getAttribute(VROW_KEY_ATTR) ?? ''),
      0,
    ) +
    px(lane.style.paddingBottom);
  const contentHeight = () =>
    px(wrapper.style.marginTop) + Math.max(0, ...laneEls.map(laneHeight));

  let scrollTop = 0;
  let scrollPending = false;
  // Like a browser, clamp scrollTop when the content shrinks under it, not
  // just on writes: whenever the position is read.
  const currentScrollTop = () => {
    const max = Math.max(0, contentHeight() - viewportHeight);
    if (scrollTop > max) {
      scrollTop = max;
      scrollPending = true;
    }
    return scrollTop;
  };
  Object.defineProperty(scroller, 'scrollTop', {
    get: currentScrollTop,
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
  const lanesTop = () => -currentScrollTop() + px(wrapper.style.marginTop);
  const cardRect = (el: Element): DOMRect => {
    const lane = el.parentElement as HTMLElement;
    let top = lanesTop() + px(lane.style.paddingTop);
    for (const card of cardsOf(lane)) {
      const h = heightOf(card.getAttribute(VROW_KEY_ATTR) ?? '');
      if (card === el) return rect(top, h);
      top += h + gap;
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
    layout: masonryLayout,
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
  // Answer the next page queries with nothing, still loading, this many
  // times.
  let empty = 0;
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
    if (empty > 0) {
      empty--;
      mainRows = [];
    }
    return assembleRows<TestRow, TestRow>(inputs, {
      singleRow: probeRow,
      singleComplete: !!inputs.probeID,
      mainRows,
      mainComplete: !partly && mainRows.length > 0,
      afterRows: undefined,
      afterComplete: false,
    });
  };

  // Render the lanes and each item into its lane, keyed like a framework.
  const syncDOM = (snapshot: ReturnType<typeof core.getSnapshot>) => {
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
      lane.style.rowGap = `${gap}px`;
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

  // On the next tick that brings different rows, keep rendering the old ones,
  // as Solid can: the core's post-render pass runs with rows the DOM doesn't
  // show yet. Returns whether this tick lagged.
  let lagDOM = false;
  const keysOf = (snapshot: ReturnType<typeof core.getSnapshot>) =>
    snapshot.items.map(item => String(item.key)).join();
  const tick = (): boolean => {
    const rendered = core.getSnapshot();
    core.setRows(answerQueries(core.getQueryInputs()));
    const lagged = lagDOM && keysOf(rendered) !== keysOf(core.getSnapshot());
    syncDOM(lagged ? rendered : core.getSnapshot());
    if (lagged) lagDOM = false;
    core.attach(scroller);
    core.afterDOMUpdate();
    deliverScroll();
    return lagged;
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
    lagDOMNext: () => {
      lagDOM = true;
    },
    emptyNext: (times = 1) => {
      empty = times;
    },
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
export function harness(...args: Parameters<typeof createHarness>) {
  const h = createHarness(...args);
  harnesses.push(h);
  return h;
}
afterEach(() => {
  while (harnesses.length) harnesses.pop()!.destroy();
});
