import {describe, expect, test} from 'vitest';
import {createHarness, harness} from './masonry-harness.ts';
import {masonryLayout, type MasonryState} from './masonry.ts';
import type {ScrollHistoryState} from './types.ts';

type TestRow = {id: string};

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

    // Each card went to the lane that was shortest when its turn came, by
    // the real heights — not the 80px estimate it was first rendered at.
    const bottoms = [0, 0, 0];
    for (const item of h.core.getSnapshot().items) {
      const key = String(item.key);
      expect(h.laneKeys()[item.lane], key).toContain(key);
      expect(bottoms[item.lane], key).toBe(Math.min(...bottoms));
      bottoms[item.lane] += h.heightOf(key);
    }
    expect(h.cardTop('r0')).toBe(0);
    const ends = laneBottoms(h);
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(120);
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

  test('under a finger, a shift of every lane is held until the gesture ends', () => {
    // Writing scrollTop mid-momentum is ignored on iOS, or ends the fling.
    // Opened mid-list, paging back up shifts every lane; while a finger is
    // down that waits in the content wrapper's margin, and goes into
    // scrollTop when the gesture ends.
    const h = harness({rowCount: 1000, options: {permalinkID: 'r300'}});
    h.settle();
    h.scroller.dispatchEvent(new Event('touchstart'));
    let held = false;
    for (let i = 0; i < 40 && !held; i++) {
      h.userScroll(Math.max(400, h.scroller.scrollTop - 300));
      const before = h.onScreen();
      h.settle();
      expect(h.onScreen()).toMatchObject(before);
      held = h.wrapper.style.marginTop !== '';
    }
    expect(held).toBe(true);

    const before = h.onScreen();
    h.scroller.dispatchEvent(new Event('touchend'));
    h.scroller.dispatchEvent(new Event('scrollend'));
    h.tick();
    expect(h.wrapper.style.marginTop).toBe('');
    expect(h.onScreen()).toEqual(before);
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
      // Cards arriving above can fill a lane's room on screen; none that
      // was there moves.
      expect(h.onScreen()).toMatchObject(before);
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
    expect(saved.layout).toHaveLength(3);
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

  test('a second restore replaces what the first still had to place', () => {
    // The first restore's cards haven't rendered when another restore
    // comes in: where it wanted them is forgotten, or they'd land there
    // when they render in the second restore's window.
    const states: ScrollHistoryState<TestRow>[] = [];
    const h = harness({
      rowCount: 1000,
      options: {onScrollStateChange: s => states.push(s)},
    });
    h.settle();
    h.userScroll(1500);
    h.settle();
    const first = states.at(-1)!;
    h.userScroll(h.scroller.scrollTop + 300);
    h.settle();
    const second = states.at(-1)!;
    const screen = h.onScreen();
    h.core.scrollToItem('r900', {align: 'start'});
    h.settle();

    h.emptyNext(2);
    h.setOptions({...h.coreOptions, scrollState: first});
    h.tick();
    h.setOptions({...h.coreOptions, scrollState: second});
    h.settle();

    expect(h.onScreen()).toEqual(screen);
  });

  test('a reload restores a position the first window cannot reach', () => {
    // The saved position is deep in the list; the first window a reload
    // loads ends well above it, so the browser clamps the viewport until
    // more rows are in. The lanes are laid out for where the viewport is
    // going, not where the clamp left it.
    const states: ScrollHistoryState<TestRow>[] = [];
    const before = harness({
      rowCount: 1000,
      options: {onScrollStateChange: s => states.push(s)},
    });
    before.settle();
    for (let i = 0; i < 4; i++) {
      before.userScroll(before.scroller.scrollTop + 1500);
      before.settle();
    }
    const saved = states.at(-1)!;
    expect(saved.scrollTop).toBeGreaterThan(2500);
    const screen = before.onScreen();

    const after = harness({rowCount: 1000, options: {scrollState: saved}});
    after.emptyNext();
    after.tick();
    expect(after.scroller.scrollTop).toBeLessThan(saved.scrollTop);
    after.settle();

    expect(after.scroller.scrollTop).toBe(saved.scrollTop);
    expect(after.onScreen()).toEqual(screen);
  });

  test('switching to masonry switches native anchoring off', () => {
    const h = harness({
      rowCount: 300,
      options: {layout: undefined, anchoring: 'native'},
    });
    h.settle();
    expect(h.scroller.style.overflowAnchor).toBe('auto');

    h.setOptions({...h.coreOptions, layout: masonryLayout});
    h.settle();
    expect(h.scroller.style.overflowAnchor).toBe('none');
  });

  test('a restore keeps its cards when the lane count arrives a commit later', () => {
    const states: ScrollHistoryState<TestRow>[] = [];
    const h = harness({
      rowCount: 1000,
      lanes: 4,
      options: {onScrollStateChange: s => states.push(s)},
    });
    h.settle();
    h.userScroll(3000);
    h.settle();
    const saved = states.at(-1)!;
    const before = h.onScreen();

    // Elsewhere, in three lanes.
    h.setOptions({...h.coreOptions, lanes: 3});
    h.settle();
    h.userScroll(6000);
    h.settle();

    // Back: the saved state lands a commit before its lane count does.
    h.setOptions({...h.coreOptions, lanes: 3, scrollState: saved});
    h.tick();
    h.setOptions({...h.coreOptions, scrollState: saved});
    h.settle();

    expect(h.onScreen()).toEqual(before);
  });

  test('a new lane count lays the cards out afresh', () => {
    const h = harness({rowCount: 1000});
    h.settle();
    h.userScroll(2000);
    h.settle();

    h.setOptions({...h.coreOptions, lanes: 4});
    h.settle();

    expect(h.lanes()).toHaveLength(4);
    const {items} = h.core.getSnapshot();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(h.laneKeys()[item.lane]).toContain(String(item.key));
    }
  });

  test('more lanes at the end of the list land at the end, like a grid', () => {
    // In four lanes the same cards end well above where the viewport was:
    // the browser clamps scrollTop to the shorter content, and the view
    // ends with the list.
    const h = harness({rowCount: 100, lanes: 2, gap: 8});
    h.settle();
    for (let i = 0; i < 10; i++) {
      h.userScroll(100_000);
      h.settle();
    }
    expect(h.scroller.scrollTop + 600).toBe(h.scroller.scrollHeight);

    h.setOptions({...h.coreOptions, lanes: 4});
    h.settle();

    expect(h.lanes()).toHaveLength(4);
    // Within a card of the end: the browser clamps while the content is at
    // its shortest, and the cards measured after that can add a little.
    const short = h.scroller.scrollHeight - (h.scroller.scrollTop + 600);
    expect(short).toBeGreaterThanOrEqual(0);
    expect(short).toBeLessThan(128);
    expect(h.laneKeys().flat()).toContain('r99');
  });

  test('lays out the cards as rendered when the rows run ahead of the DOM', () => {
    // Solid can run the post-render pass with rows its DOM doesn't show yet.
    // Sizing the lanes for cards that aren't there would move the ones that
    // are.
    const h = harness({rowCount: 1000, gap: 8, options: {permalinkID: 'r500'}});
    h.settle();
    let lagged = 0;
    for (let i = 0; i < 12; i++) {
      h.userScroll(Math.max(400, h.scroller.scrollTop - 300));
      const before = h.onScreen();
      // When this step's new rows arrive, the DOM is a commit behind — and
      // that commit may well be painted.
      h.lagDOMNext();
      for (let t = 0; t < 10; t++) {
        if (h.tick()) {
          expect(h.onScreen()).toMatchObject(before);
          lagged++;
          break;
        }
      }
      h.settle();
      expect(h.onScreen()).toMatchObject(before);
    }
    expect(lagged).toBeGreaterThan(3);
  });

  test('saves only cards of the loaded window when the rows run ahead of the DOM', () => {
    const states: ScrollHistoryState<TestRow>[] = [];
    const h = harness({
      rowCount: 1000,
      options: {onScrollStateChange: s => states.push(s)},
    });
    h.settle();
    h.userScroll(2400);
    h.settle();

    // Page with the DOM a commit behind the rows: what's saved then must be
    // of the rows, not of the cards the DOM still shows of the old window.
    h.userScroll(4400);
    h.lagDOMNext();
    let lagged = false;
    const saved = states.length;
    for (let t = 0; t < 10 && !lagged; t++) lagged = h.tick();
    expect(lagged).toBe(true);
    expect(states.length).toBeGreaterThan(saved);

    const loaded = new Set(
      h.core.getSnapshot().items.map(item => String(item.key)),
    );
    const layout = states.at(-1)!.layout as MasonryState;
    expect(layout.some(lane => lane !== null)).toBe(true);
    for (const lane of layout) {
      for (const key of lane?.keys ?? []) expect(loaded, key).toContain(key);
    }
  });
});
