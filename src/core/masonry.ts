import {queryLanes, queryRows, VROW_KEY_ATTR} from './dom.ts';
import type {Layout, LayoutFactory, LayoutHost} from './layout.ts';
import {memo} from './memo.ts';
import type {RowKey} from './types.ts';

/**
 * Masonry, for the `layout` option: the `lanes` are laid out as a
 * Pinterest-style feed. Each card goes to the shortest lane instead of the
 * next column, so cards of different heights pack without gaps.
 *
 * Render one element per lane, marked with `laneAttributes(lane)`, side by
 * side in the content wrapper (a flex row), and each item inside the lane
 * element its `lane` names, in list order. Render no spacers: the layout
 * sizes each lane's `padding-top` and `padding-bottom` itself, so leave
 * those alone. Space the cards with the lane's `gap` rather than margins,
 * and keep the lanes equally wide.
 *
 * A card keeps its lane while it's loaded and gets it back when it pages out
 * and in again. Cards are measured before they're placed, in the same frame.
 * Each lane is kept in place on its own: a card resizing above the viewport
 * moves the cards above it in its lane, never the ones on screen. So, as
 * with any layout, `anchoring` is ignored.
 *
 * Opened in the middle of the list (a permalink, a far `scrollToItem`), the
 * cards above are placed upward, so once the list's start loads the lanes
 * can start a little unevenly — by up to about a card.
 *
 * Changing `lanes` lays the cards out afresh. The scroll position stays, so
 * the cards under the viewport can shift.
 */
export const masonryLayout: LayoutFactory = host => new Masonry(host);

/**
 * What masonry saves in the scroll state ({@linkcode ScrollHistoryState.layout}):
 * each lane's cards in view — those between the first and the last card on
 * screen, in list order — and how far below the viewport's top the first of
 * them starts; null for a lane with none. A restore puts these cards back in
 * their lanes, where they were.
 */
export type MasonryState = ReadonlyArray<{
  readonly keys: readonly string[];
  readonly offset: number;
} | null>;

// Masonry keeps the cards in lanes: each goes to the lane it fits best and
// stays there. Within a lane the cards stack in list order below a
// `padding-top` the layout sizes. After every render, each lane's padding is
// set so that its first card on screen stays where it was: whatever changed
// above it — cards leaving, arriving, moving lanes, resizing — is absorbed
// there. All of it from what the DOM shows, before paint, so no frame ever
// shows a lane out of place.
class Masonry implements Layout {
  readonly #host: LayoutHost;
  // Cards are keyed by `String(key)`: the DOM hands keys back as strings.
  // Every card's lane, kept while it pages out and back in, and a version
  // bumped on every change so the host sees one.
  readonly #laneOf = new Map<string, number>();
  #laneOfVersion = 0;
  readonly #lanesOf = memo(
    (_version: number) => (_index: number, key: RowKey) =>
      this.#laneOf.get(String(key)) ?? 0,
  );
  // The cards placed at the estimate, to place again once measured.
  readonly #placedUnmeasured = new Set<string>();
  // Where each lane's first loaded card starts: its padding-top. Empty until
  // the first layout.
  #laneStart: number[] = [];
  // The footprint (height plus the lane's gap) of every rendered card, as
  // last measured, and the lanes' row gap as last read (the lanes are styled
  // alike).
  readonly #cardHeight = new Map<string, number>();
  #laneGap = 0;
  // What each lane showed at the last layout, in order, and a version bumped
  // whenever that changes, so a layout change alone gets persisted.
  #laneRendered: string[][] = [];
  version = 0;
  // The lanes' top in content coordinates, as of the last layout.
  #laneOriginTop = 0;
  // What the layout belongs to. A new list or lane count starts afresh.
  #context: {lanes: number; listContextParams: unknown} | null = null;
  // A restore's saved cards, until it lands, and the first in each lane with
  // how far below the viewport's top it goes, until it renders.
  #saved: MasonryState | undefined = undefined;
  readonly #pins = new Map<string, number>();

  constructor(host: LayoutHost) {
    this.#host = host;
  }

  lanes(): (index: number, key: RowKey) => number {
    this.#assignLanes();
    return this.#lanesOf(this.#laneOfVersion);
  }

  // The footprint of a card not measured yet: the estimate plus the gap
  // below it, like a measured one.
  #cardEstimate(): number {
    return this.#host.estimate + this.#laneGap;
  }

  // The layout belongs to one list and lane count; anything else starts
  // afresh. A restore still landing keeps the lanes it saved.
  #resetIfStale(): void {
    const context = this.#context;
    const {lanes, listContextParams} = this.#host;
    if (
      context !== null &&
      context.lanes === lanes &&
      context.listContextParams === listContextParams
    ) {
      return;
    }
    this.#context = {lanes, listContextParams};
    this.#laneOf.clear();
    this.#laneOfVersion++;
    this.#placedUnmeasured.clear();
    this.#laneStart = [];
    this.#cardHeight.clear();
    this.#laneRendered = [];
    if (this.#host.restoreScrollTop !== null) this.#seedLanes(this.#saved);
  }

  // The lane of every loaded card, assigning the ones that have none. Below
  // the cards already placed, each goes to the lane where it would start
  // highest (the shortest); above them — paging back up — to the lane where
  // it would start lowest (the most room above). Ties go to the lowest lane.
  // Heights are as measured, or the estimate for a card not rendered yet;
  // #afterRender places those again once they are.
  #assignLanes(): void {
    this.#resetIfStale();
    const {keys, lanes} = this.#host;
    const laneOf = this.#laneOf;
    // A restore's cards keep their lanes only where those exist.
    for (const key of keys) {
      const l = laneOf.get(key);
      if (l !== undefined && l >= lanes) laneOf.delete(key);
    }
    if (keys.every(key => laneOf.has(key))) return;
    const estimate = this.#cardEstimate();
    const height = (key: string) => this.#cardHeight.get(key) ?? estimate;
    const place = (key: string, l: number) => {
      laneOf.set(key, l);
      if (!this.#cardHeight.has(key)) this.#placedUnmeasured.add(key);
    };
    const top = Array.from({length: lanes}, (_, l) => this.#laneStart[l] ?? 0);
    const bottom = top.slice();
    let first = keys.findIndex(key => laneOf.has(key));
    if (first < 0) {
      first = 0;
      place(keys[0], 0);
    }
    const extreme = (edges: number[], lowest: boolean) => {
      let best = 0;
      for (let l = 1; l < lanes; l++) {
        if (lowest ? edges[l] < edges[best] : edges[l] > edges[best]) best = l;
      }
      return best;
    };
    for (let i = first; i < keys.length; i++) {
      const key = keys[i];
      let l = laneOf.get(key);
      if (l === undefined) place(key, (l = extreme(bottom, true)));
      bottom[l] += height(key);
    }
    for (let i = first - 1; i >= 0; i--) {
      const key = keys[i];
      let l = laneOf.get(key);
      if (l === undefined) place(key, (l = extreme(top, false)));
      top[l] -= height(key);
    }
    this.#laneOfVersion++;
  }

  restore(state: unknown): void {
    this.#seedLanes(isMasonryState(state) ? state : undefined);
  }

  // A restore's cards: back in their lanes, the first in each at its offset
  // below the viewport's top once it renders (see #afterRender).
  #seedLanes(cards: MasonryState | undefined): void {
    this.#saved = cards;
    // A new restore replaces what the last one still had to place.
    this.#pins.clear();
    if (cards === undefined) return;
    const {lanes} = this.#host;
    cards.forEach((lane, l) => {
      // Saved under another lane count, a lane may not exist now.
      if (lane === null || l >= lanes) return;
      for (const key of lane.keys) this.#laneOf.set(key, l);
      this.#pins.set(lane.keys[0], lane.offset);
    });
    this.#laneOfVersion++;
  }

  // Keep every lane in place and size the lanes, from what the DOM shows now
  // against what it showed last time.
  afterRender(): void {
    const host = this.#host;
    this.#resetIfStale();
    const laneEls = queryLanes(host.el);
    const firstLane = laneEls.find(el => el !== undefined);
    if (firstLane === undefined) return;
    const {lanes, rows} = host;
    const estimate = this.#cardEstimate();
    const heights = this.#cardHeight;
    const height = (key: string) => heights.get(key) ?? estimate;

    // What each lane shows now, in order.
    const now: {key: string; el: HTMLElement}[][] = Array.from(
      {length: lanes},
      () => [],
    );
    laneEls.forEach((el, l) => {
      if (el === undefined || l >= lanes) return;
      for (const row of queryRows(el)) {
        now[l].push({key: row.getAttribute(VROW_KEY_ATTR) ?? '', el: row});
      }
    });

    // In each lane, the first card still shown that reaches into the
    // viewport keeps its place — or the last one above it, when none does.
    // Whatever changes above it (cards leaving, arriving, moving lanes or
    // resizing) goes into the lane's padding instead. Positions as of the
    // last layout, and the viewport as last reported: nothing may read
    // layout before the lanes are sized for what the render removed, or the
    // browser clamps the viewport to content that is short for a moment.
    // While a restore lands, the viewport is where the restore is taking it,
    // which the content on hand may not reach yet.
    const scrollTop = host.restoreScrollTop ?? host.reportedScrollTop;
    const vTop = scrollTop + host.pendingJump - this.#laneOriginTop;
    const pins = this.#laneRendered.map((lane, l) => {
      const shown = new Set(now[l]?.map(card => card.key));
      let top = this.#laneStart[l] ?? 0;
      let last: {key: string; top: number} | null = null;
      for (const key of lane) {
        const bottom = top + height(key);
        if (shown.has(key)) {
          if (bottom > vTop) return {key, top};
          last = {key, top};
        }
        top = bottom;
      }
      return last;
    });
    const fresh = pins.every(pin => pin === null);
    if (fresh) {
      // Afresh: every lane starts where the cards not loaded above are
      // estimated to end.
      const above = rows.atStart
        ? 0
        : Math.ceil(Math.max(0, rows.firstRowIndex) / lanes) * estimate;
      this.#laneStart = Array.from({length: lanes}, () => above);
    }
    const start = this.#laneStart;
    const startBefore = start.slice();
    const startFor = (l: number): number => {
      const pin = pins[l];
      if (pin === null || pin === undefined) return start[l];
      let before = 0;
      for (const card of now[l]) {
        if (card.key === pin.key) break;
        before += height(card.key);
      }
      return pin.top - before;
    };
    // Size the lanes: where each starts, and room for what's unloaded
    // below. Written before anything reads layout, with the heights known
    // so far, so the content never measures short and gets the viewport
    // clamped to it. Then exactly, from the measured heights.
    const end = rows.firstRowIndex + rows.rowsLength;
    const below = rows.atEnd
      ? 0
      : Math.ceil(Math.max(0, host.estimatedTotal - end) / lanes) * estimate;
    const write = () =>
      laneEls.forEach((el, l) => {
        if (el !== undefined && l < lanes) {
          setPx(el, 'paddingTop', now[l].length > 0 ? start[l] : 0);
          setPx(el, 'paddingBottom', below);
        }
      });
    for (let l = 0; l < lanes; l++) start[l] = startFor(l);
    write();

    // Measure every card shown. Cards placed at the estimate are now known.
    const placed = new Set<string>();
    const measured = new Map<string, number>();
    now.forEach((lane, l) => {
      const gap = pixels(getComputedStyle(laneEls[l]!).rowGap);
      if (l === 0) this.#laneGap = gap;
      for (const card of lane) {
        measured.set(card.key, card.el.getBoundingClientRect().height + gap);
        if (this.#placedUnmeasured.delete(card.key)) placed.add(card.key);
      }
    });
    heights.clear();
    for (const [key, h] of measured) heights.set(key, h);
    for (let l = 0; l < lanes; l++) start[l] = startFor(l);

    // A restore's cards, where it saved them: below the viewport's top as
    // it will be once the restore lands (the content on hand may not reach
    // its scrollTop yet).
    now.forEach((lane, l) => {
      let top = start[l];
      for (const card of lane) {
        const offset = this.#pins.get(card.key);
        if (offset !== undefined) {
          this.#pins.delete(card.key);
          start[l] += vTop + offset - top;
          break;
        }
        top += height(card.key);
      }
    });

    // A lane starting above the content moves every lane down by the same
    // amount, and the viewport with it, so nothing on screen moves. Once the
    // list's true start is loaded, the topmost lane starts at 0 exactly. At
    // the very top, as in a list, content arriving above is revealed.
    let min = Infinity;
    now.forEach((lane, l) => {
      if (lane.length > 0) min = Math.min(min, start[l]);
    });
    const shift =
      min === Infinity
        ? 0
        : host.settled && rows.atStart
          ? -min
          : Math.max(0, -min);
    for (let l = 0; l < lanes; l++) start[l] += shift;

    write();
    // Where the lanes are now — read before any scroll write, so the write
    // is clamped against the content as just sized, not as it was.
    this.#laneOriginTop =
      firstLane.getBoundingClientRect().top -
      host.viewportTop +
      host.scrollTop +
      host.pendingJump;
    // Scroll with the shift now that the content reaches that far.
    if (shift !== 0) {
      if (host.restoreScrollTop !== null) host.restoreScrollTop += shift;
      if (scrollTop > 0 || host.landing) host.compensate(shift);
    }
    // Persist a change to the lanes alone: the cards in them, or where they
    // start (a card resizing above the viewport moves what's saved too).
    const rendered = now.map(lane => lane.map(card => card.key));
    if (
      rendered.length !== this.#laneRendered.length ||
      rendered.some((lane, l) => !sameKeys(lane, this.#laneRendered[l])) ||
      start.some((top, l) => top !== startBefore[l])
    ) {
      this.version++;
    }
    this.#laneRendered = rendered;
    if (host.restoreScrollTop === null) {
      this.#saved = undefined;
      this.#pins.clear();
    }

    // Cards placed at the estimate, now measured: place them again by their
    // real heights, and render once more, still before paint, if that moves
    // any. The next pass keeps the lanes in place around the moves.
    if (placed.size === 0) return;
    for (const key of placed) this.#laneOf.delete(key);
    this.#assignLanes();
    const laneOf = this.#laneOf;
    const moved = now.some((lane, l) =>
      lane.some(card => placed.has(card.key) && laneOf.get(card.key) !== l),
    );
    if (moved) host.rerender();
  }

  // What a restore needs to put the cards on screen back (see
  // MasonryState): each lane's cards from the first to the last card on
  // screen in list order, and where the first of them starts — a card
  // outside that span can't be placed between two of them. From the last
  // layout, so no DOM read per scroll.
  save(): MasonryState | undefined {
    const host = this.#host;
    if (this.#laneRendered.length === 0) return undefined;
    const estimate = this.#cardEstimate();
    const order = new Map(host.keys.map((key, i) => [key, i]));
    const vTop = host.scrollTop + host.pendingJump - this.#laneOriginTop;
    const vBottom = vTop + host.viewportHeight;
    const placed = this.#laneRendered.map((lane, l) => {
      let top = this.#laneStart[l] ?? 0;
      return lane.map(key => {
        const card = {key, order: order.get(key) ?? Infinity, top};
        top += this.#cardHeight.get(key) ?? estimate;
        return card;
      });
    });
    let first = Infinity;
    let last = -Infinity;
    for (const lane of placed) {
      for (const card of lane) {
        const bottom = card.top + (this.#cardHeight.get(card.key) ?? estimate);
        if (bottom > vTop && card.top < vBottom) {
          first = Math.min(first, card.order);
          last = Math.max(last, card.order);
        }
      }
    }
    if (first === Infinity) return undefined;
    return placed.map(lane => {
      const span = lane.filter(
        card => card.order >= first && card.order <= last,
      );
      return span.length === 0
        ? null
        : {keys: span.map(card => card.key), offset: span[0].top - vTop};
    });
  }
}

// Saved by this or an earlier version of the app: anything else is ignored.
function isMasonryState(state: unknown): state is MasonryState {
  return (
    Array.isArray(state) &&
    state.every(
      (lane: unknown) =>
        lane === null ||
        (typeof lane === 'object' &&
          lane !== null &&
          Array.isArray((lane as {keys?: unknown}).keys) &&
          (lane as {keys: unknown[]}).keys.length > 0 &&
          typeof (lane as {offset?: unknown}).offset === 'number'),
    )
  );
}

// Key by key: keys are the app's strings, which may hold any separator.
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

function pixels(value: string): number {
  return value.endsWith('px') ? Number.parseFloat(value) || 0 : 0;
}

function setPx(
  el: HTMLElement,
  prop: 'paddingTop' | 'paddingBottom',
  px: number,
): void {
  const value = `${px}px`;
  if (el.style[prop] !== value) el.style[prop] = value;
}
