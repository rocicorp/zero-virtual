import {afterEach, describe, expect, test, vi} from 'vitest';
import {assembleRows, type RowsQueryInputs} from './rows.ts';
import {VROW_INDEX_ATTR, VROW_KEY_ATTR} from './dom.ts';
import {ZeroVirtualizer, type VirtualizerOptions} from './virtualizer.ts';
import type {Anchor, ScrollHistoryState} from './types.ts';

type TestRow = {id: string; rowid?: bigint};

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
  bigintRows = false,
  options = {},
}: {
  rowCount: number;
  rowHeight?: number;
  viewportHeight?: number;
  /** Give rows an int64-ish column, which JSON can't serialize. */
  bigintRows?: boolean;
  options?: Partial<VirtualizerOptions<unknown, TestRow, TestRow>>;
}) {
  const data: TestRow[] = Array.from({length: rowCount}, (_, i) => ({
    id: `r${i}`,
    ...(bigintRows ? {rowid: BigInt(i)} : {}),
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

  // The geometry a real scroll container reports, kept consistent with the
  // clamping above: the core reads these to tell a clamped write of its own
  // from the user scrolling somewhere else.
  Object.defineProperty(scroller, 'scrollHeight', {
    get: () => contentHeight(),
  });
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
  const coreOptions: VirtualizerOptions<unknown, TestRow, TestRow> = {
    estimateSize: () => rowHeight,
    getRowKey: row => row.id,
    listContextParams: 'ctx',
    anchoring: 'native',
    // Pinned so the paging expectations below (page lengths, anchor indices,
    // spaceBefore) stay fixed to a 100-row page rather than tracking the
    // minPageSize default.
    minPageSize: 100,
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
  const core = new ZeroVirtualizer<unknown, TestRow, TestRow>(coreOptions);

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
    // Under a page anchor the single-row slot answers `probeID` — the
    // existence check a jump runs before it re-anchors.
    const probeRow = inputs.probeID
      ? data.find(r => r.id === inputs.probeID)
      : undefined;
    return assembleRows<TestRow, TestRow>(inputs, {
      singleRow: probeRow,
      singleComplete: !!inputs.probeID,
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

  // A commit before the scroll container is mounted: rows are staged but the
  // element isn't attached yet (a host that renders its scroll container
  // lazily — e.g. after measuring available space — attaches on a later tick).
  const tickDetached = () => {
    core.setRows(answerQueries(core.getQueryInputs()));
    core.attach(null);
    core.afterDOMUpdate();
  };

  // Settled = the queries stopped changing: the anchor holds still and no
  // id lookup (`probeID`) is in flight. Spelled out field by field rather
  // than stringified, so the harness imposes no serializability requirement
  // of its own on the rows under test (see `bigintRows`).
  const queryKey = () => {
    const {anchor, probeID} = core.getQueryInputs();
    const cursor =
      anchor.kind === 'permalink' ? anchor.id : (anchor.startRow?.id ?? '');
    return `${anchor.kind}:${anchor.index}:${cursor}:${probeID ?? ''}`;
  };

  const settle = (maxTicks = 20) => {
    for (let i = 0; i < maxTicks; i++) {
      const before = queryKey();
      tick();
      if (queryKey() === before) return;
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
    coreOptions,
    scroller,
    wrapper,
    tick,
    tickDetached,
    settle,
    userScroll,
    deliverScroll,
    visibleIndexes,
    setRowHeight: (key: string, px: number) => heights.set(key, px),
    rowElement: (key: string) => {
      const el = wrapper.querySelector<HTMLElement>(
        `[${VROW_KEY_ATTR}="${key}"]`,
      );
      if (!el) throw new Error(`row ${key} not rendered`);
      return el;
    },
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

describe('scroll-state restore when the container mounts lazily', () => {
  const savedState = (scrollTop: number): ScrollHistoryState<TestRow> => ({
    anchor: {kind: 'forward', index: 0},
    scrollTop,
    estimatedTotal: 100,
    hasReachedStart: true,
    hasReachedEnd: false,
    listContextParams: 'ctx',
  });

  test('restores the saved scrollTop when the element attaches on a later commit', () => {
    const h = harness({
      rowCount: 100,
      options: {scrollState: savedState(300)},
    });

    // The host renders (and thus attaches) the scroll container only after a
    // couple of commits — e.g. once it has measured available space.
    h.tickDetached();
    h.tickDetached();
    // Nothing to restore against yet: no element, no scroll applied.
    expect(h.scroller.scrollTop).toBe(0);

    // The container mounts and attaches; the restore must now actually run
    // rather than treat the (never-performed) detached restore as done.
    h.settle();
    expect(h.scroller.scrollTop).toBe(300);
  });

  test('does not persist a spurious scrollTop:0 while detached, clobbering the saved position', () => {
    vi.useFakeTimers();
    try {
      const persisted: Array<ScrollHistoryState<TestRow>> = [];
      const h = harness({
        rowCount: 100,
        options: {
          scrollState: savedState(300),
          onScrollStateChange: s =>
            persisted.push(s as ScrollHistoryState<TestRow>),
        },
      });

      h.tickDetached();
      h.tickDetached();
      // Fire any pending persist debounce: nothing should have been written
      // while detached (a write here would be a scrollTop:0 over the saved 300).
      vi.advanceTimersByTime(1000);
      expect(persisted).toEqual([]);

      h.settle();
      vi.advanceTimersByTime(1000);
      // Once attached, the restored position is persisted — and never a
      // spurious 0.
      expect(persisted.length).toBeGreaterThan(0);
      expect(persisted.map(s => s.scrollTop)).not.toContain(0);
      expect(h.scroller.scrollTop).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('permalink scroll', () => {
  test('scrolls the permalink row into view when its row key differs from the permalink id', () => {
    // Deep-link by a human-friendly id (`r120`) while keying rows by something
    // else (`key-r120`) — the common short-id-URL / uuid-key split. The scroll
    // must still land, located via the resolved row's key, not the raw id.
    const h = harness({
      rowCount: 300,
      options: {
        permalinkID: 'r120',
        getRowKey: row => `key-${row.id}`,
      },
    });
    h.settle();

    // The target row is scrolled into view near the top. Without the fix
    // `findRow` looks up `r120` (the permalink id) against DOM rows keyed
    // `key-r120`, never matches, and the row stays far below the viewport.
    const top = h.rowTop('key-r120');
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(40); // within ~a row of the top
  });
});

describe('scroll-state restore of a position we wrote ourselves', () => {
  test('a jump that took a long time to load still outranks the echo', () => {
    // The echo window is refreshed while a jump is in flight — but the commit
    // it lands on retires the request first, so that one has to count too.
    // Otherwise a jump whose pages took longer than the window to arrive (a
    // cold cache) lands with the window already expired, and the pre-jump
    // position the host is still holding comes back as a restore and undoes
    // it.
    const persisted: Array<ScrollHistoryState<TestRow>> = [];
    const h = harness({
      rowCount: 500,
      options: {
        anchoring: 'manual',
        onScrollStateChange: s =>
          persisted.push(s as ScrollHistoryState<TestRow>),
      },
    });
    h.settle();
    h.userScroll(400);
    h.scroller.dispatchEvent(new Event('scrollend'));
    const preJump = persisted.at(-1)!;

    h.core.scrollToItem('r400', {align: 'start'});
    h.tick(); // the lookup answers and paging re-anchors

    // …and then the pages take their time.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      h.tick(); // they arrive: the jump lands, and the request is retired here

      // The host hands back the position from before the jump.
      h.core.setOptions({...h.coreOptions, scrollState: {...preJump}});
      h.tick();
    } finally {
      Date.now = realNow;
    }

    expect(h.rowTop('r400')).toBe(0);
  });

  test('a later navigation back to it still restores', () => {
    // The core ignores its own position coming straight back to it (the host
    // echoes what was just persisted). That must not extend to a real
    // back/forward navigation to a position it persisted a while ago — with no
    // permalink in play, nothing else would bring the viewport back.
    const persisted: Array<ScrollHistoryState<TestRow>> = [];
    const h = harness({
      rowCount: 500,
      options: {
        onScrollStateChange: s =>
          persisted.push(s as ScrollHistoryState<TestRow>),
      },
    });
    h.settle();

    h.userScroll(400);
    h.scroller.dispatchEvent(new Event('scrollend'));
    const earlier = persisted.at(-1)!;
    expect(earlier.scrollTop).toBe(400);

    h.userScroll(1200);
    h.scroller.dispatchEvent(new Event('scrollend'));
    h.settle();

    // Back: the host hands the earlier entry's state back as a new object.
    h.core.setOptions({...h.coreOptions, scrollState: {...earlier}});
    h.tick();

    expect(h.scroller.scrollTop).toBe(400);
  });
});

describe('compareStartRows', () => {
  // An int64 column read as a bigint. The anchor carries the row it paged
  // from, so the cursor carries the bigint, and every comparison the core
  // makes of one anchor against another has to get past it.
  const compareStartRows = (a: TestRow, b: TestRow) =>
    a.rowid === b.rowid ? 0 : (a.rowid ?? 0n) < (b.rowid ?? 0n) ? -1 : 1;

  const scrolledPastAPage = (
    options: Partial<VirtualizerOptions<unknown, TestRow, TestRow>>,
  ) => {
    const persisted: Array<ScrollHistoryState<TestRow>> = [];
    const h = harness({
      rowCount: 500,
      bigintRows: true,
      options: {
        anchoring: 'manual',
        onScrollStateChange: s =>
          persisted.push(s as ScrollHistoryState<TestRow>),
        ...options,
      },
    });
    h.settle();
    // Far enough that paging re-anchors: the anchor now carries a start row
    // rather than the bare top-of-list one.
    h.userScroll(1500);
    h.settle();
    h.scroller.dispatchEvent(new Event('scrollend'));
    return {h, persisted};
  };

  // What a host hands back: the Navigation API structured-clones, so the
  // anchor is a different object carrying an equal bigint. Passing the saved
  // object itself would compare by identity and prove nothing.
  const asRestoredByAHost = (state: ScrollHistoryState<TestRow>) =>
    structuredClone(state);

  test('a start row JSON cannot serialize survives the round trip', () => {
    const {h, persisted} = scrolledPastAPage({compareStartRows});

    const saved = persisted.at(-1)!;
    const {anchor} = saved;
    if (anchor.kind === 'permalink') throw new Error('expected a page anchor');
    expect(typeof anchor.startRow?.rowid).toBe('bigint');

    // The state comes back: the echo check compares it against the ones we
    // wrote, anchor included.
    h.core.setOptions({
      ...h.coreOptions,
      compareStartRows,
      scrollState: asRestoredByAHost(saved),
    });

    expect(() => h.tick()).not.toThrow();
  });

  test('is what makes that work: without it the compare throws', () => {
    // Not a lament for the old behaviour — a check that the comparator is
    // carrying the weight the test above credits it with, rather than the
    // comparison being skipped by an identity fast path.
    const {h, persisted} = scrolledPastAPage({compareStartRows});
    const saved = persisted.at(-1)!;

    h.core.setOptions({
      ...h.coreOptions,
      compareStartRows: undefined,
      scrollState: asRestoredByAHost(saved),
    });

    expect(() => h.tick()).toThrow(/BigInt/);
  });
});

describe('persist timing', () => {
  test('persists immediately on scrollend, before the debounce, so a fast navigation keeps the position', () => {
    const persisted: Array<ScrollHistoryState<TestRow>> = [];
    const h = harness({
      rowCount: 100,
      options: {
        onScrollStateChange: s =>
          persisted.push(s as ScrollHistoryState<TestRow>),
      },
    });
    h.settle();
    persisted.length = 0;

    // Scroll, then the browser signals scrolling ended — without any debounce
    // time elapsing. The position must already be persisted, so navigating
    // away right now (e.g. clicking a row) doesn't lose it.
    h.userScroll(300);
    h.scroller.dispatchEvent(new Event('scrollend'));

    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.at(-1)!.scrollTop).toBe(300);
  });
});

describe('no-op re-anchor does not spin the render loop', () => {
  test('loaded rows entirely below the viewport at scroll-top stay put (window list under other page content)', () => {
    // Fully loaded, at rest, anchored at the top.
    const h = harness({rowCount: 5});
    h.settle();
    expect(h.core.getSnapshot().complete).toBe(true);

    // Simulate other page content above the list (e.g. zbugs' issue detail
    // above the window-scrolled comments): every rendered row now sits below
    // the viewport, and the page is scrolled to the very top (offset 0).
    h.wrapper.style.marginTop = '1000px';

    // Each commit runs afterDOMUpdate → #evaluatePaging, which finds no row in
    // the viewport and re-selects the top anchor. That anchor is already the
    // current one, so it must be a no-op: before the fix it bumped the version
    // and notified on every commit, which the React binding turns into an
    // infinite re-render ("Maximum update depth exceeded").
    let notifies = 0;
    const unsub = h.core.subscribe(() => notifies++);
    h.core.afterDOMUpdate();
    h.core.afterDOMUpdate();
    h.core.afterDOMUpdate();
    unsub();

    expect(notifies).toBe(0);
  });
});

describe('below-viewport window at the start of the list', () => {
  test('scrolling while the loaded rows sit below the viewport does not empty them', () => {
    // Fully-loaded-from-the-top list, complete and at the start.
    const h = harness({rowCount: 300});
    h.settle();
    expect(h.core.getSnapshot().items.length).toBeGreaterThan(0);

    // Other page content above the list: every loaded row renders below the
    // viewport (a window-scrolled list under a tall header/detail).
    h.wrapper.style.marginTop = '1000px';

    // The user scrolls down through that content — offset > 0, but the rows are
    // still below the viewport. #evaluatePaging must NOT page backward from the
    // start (there is nothing before row 0; that page is empty and would clear
    // the list). The loaded top-of-list rows must survive.
    h.userScroll(150);
    h.settle();
    expect(h.core.getSnapshot().items.length).toBeGreaterThan(0);
  });
});

describe('scrollToItem', () => {
  test('a loaded row scrolls immediately, without re-anchoring', () => {
    const h = harness({rowCount: 500});
    h.settle();
    const anchorBefore = h.core.getQueryInputs().anchor;

    // r50 is loaded (window 0-99) but below the viewport (rows 0-19).
    h.core.scrollToItem('r50', {align: 'start'});

    expect(h.rowTop('r50')).toBe(0);
    // No re-query: the row was already in the DOM.
    expect(h.core.getQueryInputs().anchor).toEqual(anchorBefore);
  });

  test('an unloaded row re-anchors and the scroll lands once its page renders', () => {
    // Manual anchoring: the permalink window's coordinate space is relabeled
    // on the commit after the jump lands (phantom space appears above the
    // loaded window), and compensating for that relabel is the anchoring's
    // job. Under `native` the browser does it — which happy-dom does not
    // emulate, so the row would end up one placeholder row low here.
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();

    // r400 is far outside the loaded window, so the target's page has to load
    // first; the scroll lands on a later commit.
    h.core.scrollToItem('r400', {align: 'start'});
    h.settle();

    expect(h.rowTop('r400')).toBe(0);
  });

  test('is level-triggered: the same id twice scrolls twice', () => {
    const h = harness({rowCount: 500});
    h.settle();

    h.core.scrollToItem('r50', {align: 'start'});
    expect(h.rowTop('r50')).toBe(0);

    h.userScroll(0);
    h.tick();
    expect(h.rowTop('r50')).toBe(1000);

    h.core.scrollToItem('r50', {align: 'start'});
    expect(h.rowTop('r50')).toBe(0);
  });

  describe('align', () => {
    test('defaults to auto: a row below the viewport scrolls just into view', () => {
      const h = harness({rowCount: 500});
      h.settle();

      h.core.scrollToItem('r50');

      // 400px viewport, 20px row: the row's bottom at the viewport's bottom.
      expect(h.rowTop('r50')).toBe(380);
    });

    test('auto leaves an already-visible row where it is', () => {
      const h = harness({rowCount: 500});
      h.settle();
      h.userScroll(500); // rows 25-44 visible
      h.settle();
      const before = h.scroller.scrollTop;

      h.core.scrollToItem('r30', {align: 'auto'});

      expect(h.scroller.scrollTop).toBe(before);
    });

    test('start puts the row at the top of the viewport', () => {
      const h = harness({rowCount: 500});
      h.settle();

      h.core.scrollToItem('r50', {align: 'start'});

      expect(h.rowTop('r50')).toBe(0);
    });

    test('center puts the row in the middle of the viewport', () => {
      const h = harness({rowCount: 500});
      h.settle();

      h.core.scrollToItem('r50', {align: 'center'});

      expect(h.rowTop('r50')).toBe(190);
    });

    test('end puts the row at the bottom of the viewport', () => {
      const h = harness({rowCount: 500});
      h.settle();

      h.core.scrollToItem('r50', {align: 'end'});

      expect(h.rowTop('r50')).toBe(380);
    });
  });

  test("aligns below the container's scroll-padding (a sticky header)", () => {
    const h = harness({rowCount: 500});
    h.settle();
    // A sticky header covering the top 60px of the scrollport, declared the
    // way `scrollIntoView` reads it.
    h.scroller.style.scrollPaddingTop = '60px';

    h.core.scrollToItem('r50', {align: 'start'});

    // Top-aligned means the top of what can actually be seen.
    expect(h.rowTop('r50')).toBe(60);
  });

  test("keeps the space the target row's scroll-margin asks for", () => {
    const h = harness({rowCount: 500});
    h.settle();
    // The per-row half of the same contract: the row asks for 30px above it
    // rather than the container declaring the strip covered.
    h.rowElement('r50').style.scrollMarginTop = '30px';

    h.core.scrollToItem('r50', {align: 'start'});

    expect(h.rowTop('r50')).toBe(30);
  });

  test('a clamped jump still releases the request, so paging keeps working', () => {
    const h = harness({rowCount: 500});
    h.settle();

    // Centering a row at the very start of the list clamps at scrollTop 0, so
    // the requested alignment is never reached. The request must still be
    // released — a pending one stands down both paging and anchoring.
    h.core.scrollToItem('r1', {align: 'center'});
    h.settle();
    expect(h.scroller.scrollTop).toBe(0);

    // Paging still advances the window when the user scrolls near its end.
    h.userScroll(1500);
    h.settle();
    expect(h.core.getSnapshot().items[0].index).toBe(56);
  });

  test('a loaded row keyed differently from its id is scrolled to, not re-fetched', () => {
    // Address rows by a short id while keying them by something else. r50 is
    // already loaded — under `key-r50`, which the id alone can't find — so the
    // lookup that confirms the id exists also says which row it is, and the
    // jump scrolls to it instead of throwing the window away to re-fetch it.
    const h = harness({
      rowCount: 500,
      options: {anchoring: 'manual', getRowKey: row => `key-${row.id}`},
    });
    h.settle();

    h.core.scrollToItem('r50', {align: 'start'});
    const anchorKinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      h.tick();
      anchorKinds.push(h.core.getQueryInputs().anchor.kind);
    }

    expect(h.rowTop('key-r50')).toBe(0);
    // Never re-anchored: the window that was already on screen served it.
    expect(anchorKinds).not.toContain('permalink');
  });

  test('a repeat jump to a row keyed differently from its id still lands', () => {
    // Deep-link by a short id while keying rows by something else: `findRow`
    // can't see the target under the id, so a repeat call lands on the "the
    // query is already hunting for this" path. It may only sit and wait there
    // while that load is still running — once it has finished, no further
    // commit is coming, and a request left pending stands paging and anchoring
    // down for the rest of the session.
    const h = harness({
      rowCount: 500,
      options: {anchoring: 'manual', getRowKey: row => `key-${row.id}`},
    });
    h.settle();

    h.core.scrollToItem('r400', {align: 'start'});
    h.settle();
    expect(h.rowTop('key-r400')).toBe(0);

    // The repeat call has to schedule work — a re-query, a scroll, something
    // that brings another commit. Sitting on the request instead would mean
    // nothing ever lands it (no commit is coming; the load finished), and a
    // request left pending stands paging and anchoring down from here on.
    let notified = 0;
    const unsubscribe = h.core.subscribe(() => notified++);
    h.core.scrollToItem('r400', {align: 'center'});
    unsubscribe();
    expect(notified).toBeGreaterThan(0);

    h.settle();
    expect(h.rowTop('key-r400')).toBe(190);

    // And paging still works afterwards.
    h.userScroll(0);
    h.settle();
    expect(h.core.getSnapshot().items.length).toBeGreaterThan(0);
  });

  test('an empty id is a no-op, not a lookup that never answers', () => {
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();

    // The lookup for an empty id is never issued, so a request waiting on one
    // would wait forever — and a request in flight swallows `scrollState`
    // restores and sends later jumps down the re-anchor path.
    h.core.scrollToItem('');
    h.tick();

    expect(h.core.getQueryInputs().probeID).toBeNull();

    // And a real jump afterwards still takes the ordinary route.
    h.core.scrollToItem('r400', {align: 'start'});
    h.settle();
    expect(h.rowTop('r400')).toBe(0);
  });

  test('a second jump to a rendered row supersedes a lookup still in flight', () => {
    // The first jump is off looking its target up; the second lands right
    // away because its row is already on screen. The stale lookup must not
    // come back and re-anchor the list onto the first target.
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();

    h.core.scrollToItem('r400', {align: 'start'});
    h.core.scrollToItem('r50', {align: 'start'});
    expect(h.rowTop('r50')).toBe(0);

    h.settle();

    expect(h.rowTop('r50')).toBe(0);
  });

  test('a second jump supersedes one that is still loading', () => {
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();

    h.core.scrollToItem('r400', {align: 'start'});
    h.core.scrollToItem('r200', {align: 'start'});
    h.settle();

    expect(h.rowTop('r200')).toBe(0);
  });

  describe('an id that does not exist', () => {
    test('does nothing: the list and the scroll position are left alone', () => {
      const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
      h.settle();
      h.userScroll(500);
      h.settle();
      const itemsBefore = h.core.getSnapshot().items.length;
      const firstBefore = h.core.getSnapshot().items[0].index;
      const topBefore = h.rowTop('r30');
      const scrollBefore = h.scroller.scrollTop;

      // Before the existence check this re-anchored on the id and emptied the
      // whole list, permanently — the loaded window was thrown away for a
      // permalink page that never arrives.
      h.core.scrollToItem('nope');
      h.settle();

      expect(h.core.getSnapshot().items.length).toBe(itemsBefore);
      expect(h.core.getSnapshot().items[0].index).toBe(firstBefore);
      expect(h.core.getSnapshot().rowsEmpty).toBe(false);
      expect(h.rowTop('r30')).toBe(topBefore);
      expect(h.scroller.scrollTop).toBe(scrollBefore);
    });

    test('takes its lookup back out of the query inputs', () => {
      // Dropping the probe has to reach the wrapper: `probeID` only leaves
      // the query inputs on a re-render, and nothing else in that commit is
      // guaranteed to ask for one. Without the notify the single-row lookup
      // stays subscribed to an id nobody is waiting on any more.
      const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
      h.settle();

      h.core.scrollToItem('nope');
      expect(h.core.getQueryInputs().probeID).toBe('nope');

      let notified = 0;
      const unsubscribe = h.core.subscribe(() => notified++);
      h.tick(); // the lookup comes back empty
      unsubscribe();

      expect(h.core.getQueryInputs().probeID).toBeNull();
      expect(notified).toBeGreaterThan(0);
    });

    test('leaves paging working afterwards', () => {
      const h = harness({rowCount: 500});
      h.settle();

      h.core.scrollToItem('nope');
      h.settle();

      // Nothing is left pending: the window still advances as the user
      // scrolls toward its end.
      h.userScroll(1500);
      h.settle();
      expect(h.core.getSnapshot().items[0].index).toBe(56);
    });

    test('a later jump to a real id still lands', () => {
      const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
      h.settle();

      h.core.scrollToItem('nope');
      h.settle();

      h.core.scrollToItem('r400', {align: 'start'});
      h.settle();

      expect(h.rowTop('r400')).toBe(0);
    });

    test('the lookup does not disturb the list while it is in flight', () => {
      const h = harness({rowCount: 500});
      h.settle();
      const firstBefore = h.core.getSnapshot().items[0].index;

      // The commit that issues the lookup must not move the window: it is
      // the current anchor's rows that stay on screen, not a loading state.
      h.core.scrollToItem('r400');
      h.tick();

      expect(h.core.getSnapshot().items[0].index).toBe(firstBefore);
      expect(h.core.getSnapshot().rowsEmpty).toBe(false);
    });
  });

  test('a permalink that does not exist leaves the list alone even mid-lookup', () => {
    // The permalink arrives while an earlier jump's lookup is still out. That
    // lookup is dropped and a new one starts for the permalink — but the
    // snapshot in hand is still the old one's, found-and-complete. Reading it
    // as this target's answer would re-anchor on an id nothing has vouched
    // for, and throw the loaded list away for a row that isn't there.
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();
    h.userScroll(500);
    h.settle();
    const firstBefore = h.core.getSnapshot().items[0].index;

    h.core.scrollToItem('r400'); // the lookup goes out
    h.core.setOptions({...h.coreOptions, permalinkID: 'nope'});
    h.settle();

    expect(h.core.getSnapshot().rowsEmpty).toBe(false);
    expect(h.core.getSnapshot().items[0].index).toBe(firstBefore);
  });

  test('a permalinkID that does not exist leaves a loaded list alone', () => {
    const h = harness({rowCount: 500, options: {anchoring: 'manual'}});
    h.settle();
    const itemsBefore = h.core.getSnapshot().items.length;

    // An in-page navigation to a permalink that resolves to nothing: same
    // rule as scrollToItem — the list that is already on screen survives.
    h.core.setOptions({...h.coreOptions, permalinkID: 'nope'});
    h.settle();

    expect(h.core.getSnapshot().items.length).toBe(itemsBefore);
    expect(h.core.getSnapshot().rowsEmpty).toBe(false);
  });

  test('a deep link to a permalinkID that does not exist falls back to the top of the list', () => {
    // Nothing loaded yet (a cold load with the id already in the URL), so
    // there is no list to protect and the anchor goes straight to the
    // permalink. When the lookup comes back empty the list must still load —
    // before, it sat empty forever.
    const h = harness({rowCount: 500, options: {permalinkID: 'nope'}});
    // The fallback waits for the not-found to hold for a few commits (a
    // freshly re-anchored lookup can still be reporting the previous one), so
    // run a few before settling.
    h.tick();
    h.tick();
    h.settle();

    expect(h.core.getSnapshot().rowsEmpty).toBe(false);
    expect(h.core.getSnapshot().items[0].index).toBe(0);
    expect(h.core.getSnapshot().items[0].row).toEqual({id: 'r0'});
  });
});
