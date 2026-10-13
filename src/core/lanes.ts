import type {RowKey} from './types.ts';

/**
 * Masonry layout: which lane (column) each card is in, and where each lane's
 * first card starts. Positions are content coordinates — px from the top of
 * the lane elements, which sit side by side and start at the same height.
 * Within a lane the cards are stacked with no gaps, so a lane is fully
 * described by its cards and its top.
 */
export type LaneLayout = {
  /** Each lane's cards, in list order. */
  readonly lanes: ReadonlyArray<ReadonlyArray<RowKey>>;
  /** Where each lane's first card starts. An empty lane's top is unused. */
  readonly tops: readonly number[];
};

export type RelayoutInput = {
  /** The lane count. */
  lanes: number;
  /** The layout on screen before this change, or null to start afresh. */
  prev: LaneLayout | null;
  /** The footprints `prev` was laid out with: the cards as they were. */
  prevHeight: (key: RowKey) => number;
  /** The loaded cards, in list order. */
  keys: readonly RowKey[];
  /**
   * Each card's footprint now — its height plus the gap below it — measured,
   * or estimated for a card not rendered yet. Lanes are equally wide, so a
   * card's footprint doesn't depend on the lane it's in.
   */
  height: (key: RowKey) => number;
  /** The lane a card was given before, if any. A card keeps its lane. */
  assigned: (key: RowKey) => number | undefined;
  /**
   * The viewport's top, in content coordinates. In each lane the first card
   * reaching below it is pinned: it keeps its position, and everything else in
   * the lane moves around it.
   */
  viewportTop: number;
  /**
   * Cards to pin at these positions instead, at most one per lane (a
   * restore). Each needs a lane from `assigned`; `prev` is then ignored.
   */
  pins?: ReadonlyMap<RowKey, number> | undefined;
  /** With nothing to keep in place, the card to lay the rest out from. */
  pivot?: RowKey | undefined;
};

export type RelayoutResult = LaneLayout & {
  /** The lane of every card in `keys`. */
  readonly laneOf: ReadonlyMap<RowKey, number>;
  /** Whether nothing was kept in place, so the layout grew from `pivot`. */
  readonly fresh: boolean;
};

type Card = {readonly key: RowKey; readonly order: number; top: number};

/**
 * Lay the loaded cards out in lanes, keeping what is on screen where it is.
 *
 * In every lane the first card that reaches below the viewport is pinned (or
 * the last card above it, when none does), and the lane is restacked around
 * it with the current footprints. So a card growing or shrinking above the
 * viewport moves the cards above it in its lane, not the ones on screen, and
 * cards paging out above or in from above change where the lane starts.
 *
 * A card that has never had a lane is placed by the usual masonry rule: below
 * the cards already laid out it goes to the lane where it would start highest
 * (the shortest), and above them — paging back up, or opening in the middle of
 * the list — to the lane where it would start lowest (the most room above).
 * Ties go to the lowest lane. A card that had a lane keeps it.
 *
 * The tops come back wherever they fall, negative included; see
 * {@linkcode settleShift}.
 */
export function relayout(input: RelayoutInput): RelayoutResult {
  const {lanes: laneCount, keys, height} = input;
  const order = new Map(keys.map((key, i) => [key, i]));
  const lanes: Card[][] = Array.from({length: laneCount}, () => []);
  // The card each lane is stacked around.
  const pins: (Card | null)[] = Array.from({length: laneCount}, () => null);
  const laneOf = new Map<RowKey, number>();

  const assigned = (key: RowKey): number | undefined => {
    const l = input.assigned(key);
    return l !== undefined && l >= 0 && l < laneCount ? l : undefined;
  };
  const pinAt = (l: number, key: RowKey, top: number) => {
    const card = {key, order: order.get(key)!, top};
    lanes[l].push(card);
    pins[l] = card;
    laneOf.set(key, l);
  };

  // What stays loaded keeps its lane and, through the pins, its position.
  const {prev} = input;
  if (input.pins !== undefined && input.pins.size > 0) {
    for (const [key, top] of input.pins) {
      const l = assigned(key);
      if (l !== undefined && order.has(key) && pins[l] === null) {
        pinAt(l, key, top);
      }
    }
  } else if (prev !== null) {
    for (let l = 0; l < Math.min(laneCount, prev.lanes.length); l++) {
      const pin = prevPin(prev, l, input.prevHeight, order, input.viewportTop);
      if (pin === null) continue;
      pinAt(l, pin.key, pin.top);
      for (const key of prev.lanes[l]) {
        const i = order.get(key);
        if (i === undefined || key === pin.key) continue;
        insert(lanes[l], {key, order: i, top: 0});
        laneOf.set(key, l);
      }
      restack(lanes[l], pins[l]!, height);
    }
  }

  const fresh = pins.every(pin => pin === null);
  if (fresh && keys.length > 0) {
    const pivot =
      input.pivot !== undefined && order.has(input.pivot)
        ? input.pivot
        : keys[0];
    pinAt(assigned(pivot) ?? 0, pivot, 0);
  }

  // Everything else, outward from what's laid out: down, then up.
  const place = (i: number, dir: 'down' | 'up') => {
    const key = keys[i];
    if (laneOf.has(key)) return;
    const h = height(key);
    const forced = assigned(key);
    let best = -1;
    let bestTop = 0;
    for (let l = 0; l < laneCount; l++) {
      if (forced !== undefined && l !== forced) continue;
      const top =
        lanes[l].length === 0
          ? neighborTop(lanes, i, dir)
          : slotTop(lanes[l], pins[l]!, i, h, height);
      // Strictly better only, so ties go to the lowest lane.
      if (best === -1 || (dir === 'down' ? top < bestTop : top > bestTop)) {
        best = l;
        bestTop = top;
      }
    }
    const card = {key, order: i, top: bestTop};
    insert(lanes[best], card);
    pins[best] ??= card;
    restack(lanes[best], pins[best], height);
    laneOf.set(key, best);
  };
  let first = keys.length;
  for (const lane of lanes) {
    if (lane.length > 0) first = Math.min(first, lane[0].order);
  }
  for (let i = first + 1; i < keys.length; i++) place(i, 'down');
  for (let i = first - 1; i >= 0; i--) place(i, 'up');

  return {
    lanes: lanes.map(lane => lane.map(card => card.key)),
    tops: lanes.map(lane => (lane.length > 0 ? lane[0].top : 0)),
    laneOf,
    fresh,
  };
}

/**
 * How far to move every lane so the layout sits right in the list: enough to
 * keep any lane from starting above the content (a negative top); to start
 * the topmost card at the very top once the list's true start is loaded; and,
 * for a fresh layout, to leave `estimatedAbove` px for the cards not loaded
 * above it. Add it to every top, and scroll by it so nothing on screen moves.
 */
export function settleShift(
  layout: LaneLayout,
  {
    fresh,
    atStart,
    estimatedAbove,
  }: {fresh: boolean; atStart: boolean; estimatedAbove: number},
): number {
  let min = Infinity;
  layout.lanes.forEach((lane, l) => {
    if (lane.length > 0) min = Math.min(min, layout.tops[l]);
  });
  if (min === Infinity) return 0;
  if (atStart) return -min;
  if (fresh) return estimatedAbove - min;
  return min < 0 ? -min : 0;
}

// The card of the previous layout to keep in place in lane `l`: the first
// card still loaded that reaches below the viewport, else the last one still
// loaded above it, with its position as it was.
function prevPin(
  prev: LaneLayout,
  l: number,
  prevHeight: (key: RowKey) => number,
  loaded: ReadonlyMap<RowKey, number>,
  viewportTop: number,
): {key: RowKey; top: number} | null {
  let top = prev.tops[l];
  let last: {key: RowKey; top: number} | null = null;
  for (const key of prev.lanes[l]) {
    const bottom = top + prevHeight(key);
    if (loaded.has(key)) {
      if (bottom > viewportTop) return {key, top};
      last = {key, top};
    }
    top = bottom;
  }
  return last;
}

// Where card `i` would start in a lane, slotted in by list order. Below the
// lane's pin it goes right under the card before it, pushing the rest down;
// above the pin, right over the card after it, pushing the rest up.
function slotTop(
  lane: readonly Card[],
  pin: Card,
  i: number,
  h: number,
  height: (key: RowKey) => number,
): number {
  if (pin.order < i) {
    let before = pin;
    for (const card of lane) if (card.order < i) before = card;
    return before.top + height(before.key);
  }
  let after = pin;
  for (const card of lane) {
    if (card.order > i) {
      after = card;
      break;
    }
  }
  return after.top - h;
}

// An empty lane takes a card level with its nearest neighbor in the list, on
// the side the layout is growing from.
function neighborTop(
  lanes: readonly Card[][],
  i: number,
  dir: 'down' | 'up',
): number {
  let best: Card | null = null;
  for (const lane of lanes) {
    for (const card of lane) {
      const near =
        dir === 'down'
          ? card.order < i && (best === null || card.order > best.order)
          : card.order > i && (best === null || card.order < best.order);
      if (near) best = card;
    }
  }
  return best?.top ?? 0;
}

function insert(lane: Card[], card: Card): void {
  let i = lane.length;
  while (i > 0 && lane[i - 1].order > card.order) i--;
  lane.splice(i, 0, card);
}

// Stack a lane's cards with no gaps, keeping `pin` where it is.
function restack(
  lane: Card[],
  pin: Card,
  height: (key: RowKey) => number,
): void {
  const p = lane.indexOf(pin);
  for (let i = p + 1; i < lane.length; i++) {
    lane[i].top = lane[i - 1].top + height(lane[i - 1].key);
  }
  for (let i = p - 1; i >= 0; i--) {
    lane[i].top = lane[i + 1].top - height(lane[i].key);
  }
}
