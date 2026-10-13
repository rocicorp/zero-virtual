import {describe, expect, test} from 'vitest';
import {
  relayout,
  settleShift,
  type LaneLayout,
  type RelayoutInput,
} from './lanes.ts';
import type {RowKey} from './types.ts';

// Cards `c0`, `c1`, … with the given footprints.
const cards = (heights: readonly number[]) => {
  const height = new Map(heights.map((h, i) => [`c${i}`, h]));
  return {
    keys: (from: number, to: number) =>
      Array.from({length: to - from}, (_, i) => `c${from + i}`),
    height: (key: RowKey) => height.get(String(key)) ?? 0,
    set: (key: string, h: number) => height.set(key, h),
  };
};

// Every card's top, from a layout.
const tops = (
  layout: LaneLayout,
  height: (key: RowKey) => number,
): Record<string, number> => {
  const out: Record<string, number> = {};
  layout.lanes.forEach((lane, l) => {
    let top = layout.tops[l];
    for (const key of lane) {
      out[String(key)] = top;
      top += height(key);
    }
  });
  return out;
};

const fromScratch = (
  overrides: Partial<RelayoutInput> &
    Pick<RelayoutInput, 'keys' | 'height' | 'lanes'>,
) =>
  relayout({
    prev: null,
    prevHeight: overrides.height,
    assigned: () => undefined,
    viewportTop: 0,
    ...overrides,
  });

describe('relayout', () => {
  test('from the top, the first cards fill the lanes in order, then each goes to the shortest', () => {
    const c = cards([100, 50, 80, 30, 60, 40]);
    const layout = fromScratch({
      lanes: 3,
      keys: c.keys(0, 6),
      height: c.height,
    });
    // c3 under c1 (lane 1 ends at 50), c4 under c3 (lane 1 at 80, ties lane 2
    // at 80 — the lower lane wins), c5 under c2 (lane 2 at 80).
    expect(layout.lanes).toEqual([['c0'], ['c1', 'c3', 'c4'], ['c2', 'c5']]);
    expect(layout.tops).toEqual([0, 0, 0]);
    expect(layout.fresh).toBe(true);
  });

  test('a card keeps the lane it was given', () => {
    const c = cards([100, 50, 80, 30]);
    const layout = fromScratch({
      lanes: 3,
      keys: c.keys(0, 4),
      height: c.height,
      assigned: key => (key === 'c3' ? 0 : undefined),
    });
    expect(layout.laneOf.get('c3')).toBe(0);
    expect(tops(layout, c.height).c3).toBe(100);
  });

  test('paging down keeps the cards on screen in place and adds the new ones to the shortest lanes', () => {
    const c = cards([100, 50, 80, 30, 60, 40, 70, 20, 90, 50, 50, 50]);
    const before = fromScratch({
      lanes: 3,
      keys: c.keys(0, 9),
      height: c.height,
    });
    const was = tops(before, c.height);

    // c0-c2 page out above, c9-c11 page in below; the viewport is at 100.
    const after = relayout({
      lanes: 3,
      prev: before,
      prevHeight: c.height,
      keys: c.keys(3, 12),
      height: c.height,
      assigned: key => before.laneOf.get(key),
      viewportTop: 100,
    });
    const now = tops(after, c.height);
    for (const key of c.keys(3, 9)) expect(now[key]).toBe(was[key]);
    // Each lane now starts where its first remaining card was.
    expect(after.lanes.map(lane => lane[0])).toEqual(['c6', 'c3', 'c5']);
    expect(after.tops).toEqual([was.c6, was.c3, was.c5]);
    // The new cards went under the shortest lanes, in order.
    const bottoms = after.lanes.map(
      (lane, l) =>
        after.tops[l] + lane.reduce((sum, key) => sum + c.height(key), 0),
    );
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(90);
    expect(after.fresh).toBe(false);
  });

  test('paging up puts each card in the lane with the most room above it', () => {
    const c = cards([60, 40, 70, 20, 90, 50, 50, 50, 30, 80]);
    // Opened at c5: c5-c9 laid out down from there.
    const before = fromScratch({
      lanes: 2,
      keys: c.keys(5, 10),
      height: c.height,
      pivot: 'c5',
    });
    const was = tops(before, c.height);

    const after = relayout({
      lanes: 2,
      prev: before,
      prevHeight: c.height,
      keys: c.keys(0, 10),
      height: c.height,
      assigned: key => before.laneOf.get(key),
      viewportTop: 0,
    });
    const now = tops(after, c.height);
    for (const key of c.keys(5, 10)) expect(now[key]).toBe(was[key]);
    // Walking up from c4, each card goes to the lane that starts lowest: c4
    // to lane 0 (a tie at 0), c3 to lane 1 (0 against -90), c2 to lane 1
    // (-20 against -90), c1 to lane 0 (a tie at -90), c0 to lane 1.
    expect(after.lanes).toEqual([
      ['c1', 'c4', 'c5', 'c7'],
      ['c0', 'c2', 'c3', 'c6', 'c8', 'c9'],
    ]);
    expect(after.tops).toEqual([-130, -150]);
  });

  test('a card growing above the viewport moves its lane above it, not the cards on screen', () => {
    const c = cards([100, 50, 80, 30, 60, 40, 70, 20, 90]);
    const before = fromScratch({
      lanes: 3,
      keys: c.keys(0, 9),
      height: c.height,
    });
    const was = tops(before, c.height);
    const prevHeight = c.height;
    const heights = new Map(c.keys(0, 9).map(key => [key, c.height(key)]));
    heights.set('c1', 80); // lane 1's first card grows by 30

    const after = relayout({
      lanes: 3,
      prev: before,
      prevHeight,
      keys: c.keys(0, 9),
      height: key => heights.get(String(key))!,
      assigned: key => before.laneOf.get(key),
      viewportTop: 70, // c1 (0-50) is above it, c3 (50-80) on screen
    });
    const now = tops(after, key => heights.get(String(key))!);
    expect(now.c3).toBe(was.c3);
    expect(after.tops).toEqual([0, -30, 0]);
  });

  test('a card growing below the viewport changes nothing above it', () => {
    const c = cards([100, 50, 80, 30, 60]);
    const before = fromScratch({
      lanes: 3,
      keys: c.keys(0, 5),
      height: c.height,
    });
    const heights = new Map(c.keys(0, 5).map(key => [key, c.height(key)]));
    heights.set('c4', 300);

    const after = relayout({
      lanes: 3,
      prev: before,
      prevHeight: c.height,
      keys: c.keys(0, 5),
      height: key => heights.get(String(key))!,
      assigned: key => before.laneOf.get(key),
      viewportTop: 0,
    });
    expect(after.tops).toEqual(before.tops);
    expect(after.lanes).toEqual(before.lanes);
  });

  test('opened in the middle, the rest is laid out down and up from the pivot', () => {
    const c = cards([30, 30, 30, 30, 30, 30, 30]);
    const layout = fromScratch({
      lanes: 3,
      keys: c.keys(0, 7),
      height: c.height,
      pivot: 'c3',
    });
    const at = tops(layout, c.height);
    // c3 first, c4 and c5 level with it, c6 below; c2-c0 above, one per lane.
    expect(at).toMatchObject({c3: 0, c4: 0, c5: 0, c6: 30});
    expect([at.c0, at.c1, at.c2]).toEqual([-30, -30, -30]);
  });

  test('cards coming back go to the lanes they had', () => {
    const c = cards([100, 50, 80, 30, 60, 40, 70, 20, 90]);
    const all = fromScratch({lanes: 3, keys: c.keys(0, 9), height: c.height});
    const lanesOf = new Map(all.laneOf);
    // Page c0-c2 out, then back in.
    const out = relayout({
      lanes: 3,
      prev: all,
      prevHeight: c.height,
      keys: c.keys(3, 9),
      height: c.height,
      assigned: key => lanesOf.get(key),
      viewportTop: 120,
    });
    const back = relayout({
      lanes: 3,
      prev: out,
      prevHeight: c.height,
      keys: c.keys(0, 9),
      height: c.height,
      assigned: key => lanesOf.get(key),
      viewportTop: 120,
    });
    expect(back.lanes).toEqual(all.lanes);
    expect(back.tops).toEqual(all.tops);
  });

  test('explicit pins put cards exactly where they were saved', () => {
    const c = cards([100, 50, 80, 30, 60, 40]);
    const layout = relayout({
      lanes: 2,
      prev: null,
      prevHeight: c.height,
      keys: c.keys(0, 6),
      height: c.height,
      assigned: key => ({c2: 0, c3: 1})[String(key)],
      viewportTop: 0,
      pins: new Map([
        ['c2', 500],
        ['c3', 520],
      ]),
    });
    const at = tops(layout, c.height);
    expect(at.c2).toBe(500);
    expect(at.c3).toBe(520);
    expect(layout.fresh).toBe(false);
  });
});

describe('settleShift', () => {
  const layout = (t: number[]): LaneLayout => ({
    lanes: t.map((_, l) => [`c${l}`]),
    tops: t,
  });

  test('keeps every lane from starting above the content', () => {
    expect(
      settleShift(layout([-40, 10, 0]), {
        fresh: false,
        atStart: false,
        estimatedAbove: 0,
      }),
    ).toBe(40);
    expect(
      settleShift(layout([5, 10, 0]), {
        fresh: false,
        atStart: false,
        estimatedAbove: 0,
      }),
    ).toBe(0);
  });

  test('starts the top card at the very top once the start is loaded', () => {
    expect(
      settleShift(layout([25, 60, 40]), {
        fresh: false,
        atStart: true,
        estimatedAbove: 0,
      }),
    ).toBe(-25);
  });

  test('leaves room for the cards above a fresh layout', () => {
    expect(
      settleShift(layout([-30, 0, -10]), {
        fresh: true,
        atStart: false,
        estimatedAbove: 400,
      }),
    ).toBe(430);
  });

  test('ignores empty lanes', () => {
    expect(
      settleShift(
        {lanes: [['c0'], []], tops: [10, -500]},
        {fresh: false, atStart: true, estimatedAbove: 0},
      ),
    ).toBe(-10);
  });
});
