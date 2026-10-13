import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {readHistoryState} from '../core/history-state.ts';
import type {ScrollHistoryState} from '../core/types.ts';
import {useHistoryScrollState} from './use-history-scroll-state.ts';

// Minimal Navigation API stub (happy-dom doesn't implement it): current-entry
// state, id and key, plus `navigate` and `currententrychange`, which is all
// core/history-state.ts uses. `id` and `key` matter — they are how the store
// tells a navigation from an in-place state write, and a replace from both,
// so the stub has to set them the way the real API does: a new id on a new or
// replaced entry, never on updateCurrentEntry; a new key only on a new entry.
// So does the order: `navigate` fires while the entry being left is still the
// current one, `currententrychange` once the new one is.
type NavigationStub = {
  /** Navigate to a fresh entry carrying `state` (push / load / reload). */
  navigate(state: unknown): void;
  /** Replace the current entry with one carrying `state`. */
  replace(state: unknown): void;
  /** Traverse to a previously visited entry, by the id `navigate` returned. */
  traverse(id: string): void;
};

let nav: NavigationStub;
let nextEntryID = 0;

function installNavigationStub(): void {
  const entries = new Map<string, unknown>();
  const keys = new Map<string, string>();
  let currentID = '';
  const listeners = new Set<() => void>();
  const navigateListeners = new Set<(e: {navigationType: string}) => void>();
  const navigateEvent = (navigationType: string) => {
    for (const listener of navigateListeners) listener({navigationType});
  };

  const newEntry = (state: unknown, key = `k${nextEntryID + 1}`) => {
    currentID = `e${++nextEntryID}`;
    entries.set(currentID, state);
    keys.set(currentID, key);
  };
  newEntry(undefined);

  const stub = {
    get currentEntry() {
      return {
        id: currentID,
        key: keys.get(currentID),
        getState: () => entries.get(currentID),
      };
    },
    updateCurrentEntry({state}: {state: unknown}) {
      // The real API structured-clones the state, and leaves the entry's id
      // alone: this is not a navigation.
      entries.set(currentID, structuredClone(state));
      for (const listener of listeners) listener();
    },
    addEventListener(type: string, listener: () => void) {
      (type === 'navigate' ? navigateListeners : listeners).add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      (type === 'navigate' ? navigateListeners : listeners).delete(listener);
    },
  };
  (globalThis as {navigation?: unknown}).navigation = stub;

  nav = {
    navigate(state) {
      navigateEvent('push');
      newEntry(structuredClone(state));
      for (const listener of listeners) listener();
    },
    replace(state) {
      navigateEvent('replace');
      newEntry(structuredClone(state), keys.get(currentID));
      for (const listener of listeners) listener();
    },
    traverse(id) {
      navigateEvent('traverse');
      currentID = id;
      for (const listener of listeners) listener();
    },
  };
}

/** The id of the entry the stub is currently on. */
function currentEntryID(): string {
  return (globalThis as {navigation: {currentEntry: {id: string}}}).navigation
    .currentEntry.id;
}

beforeEach(() => {
  vi.useFakeTimers();
  installNavigationStub();
});

afterEach(() => {
  // Let a write still pending land here rather than in the next test's stub.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Wait out the write debounce. */
function writesSettle(): void {
  vi.advanceTimersByTime(100);
}

function fakeScrollState(scrollTop: number): ScrollHistoryState<unknown> {
  return {
    anchor: {index: 0, kind: 'forward', startRow: undefined},
    scrollTop,
    estimatedTotal: 100,
    hasReachedStart: true,
    hasReachedEnd: false,
    listContextParams: {},
  };
}

test('a replace navigation does not hand its state out as an instruction', () => {
  // An app keeping a setting in the URL replaces the current entry and carries
  // its state over. That state was written where the list was; handed out as
  // a new one, it would send the list back there after the setting has
  // changed the layout.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  act(() => nav.navigate({a: fakeScrollState(300)}));
  const restored = result.current[0];
  expect(restored?.scrollTop).toBe(300);

  act(() => result.current[1](fakeScrollState(900)));
  writesSettle();
  act(() => nav.replace(readHistoryState()));
  expect(result.current[0]).toBe(restored);

  // A real navigation still reads the entry it lands on.
  act(() => nav.navigate({a: fakeScrollState(50)}));
  expect(result.current[0]?.scrollTop).toBe(50);
});

test('missing key reads as null', () => {
  const {result} = renderHook(() => useHistoryScrollState('a'));
  expect(result.current[0]).toBeNull();
});

test('missing key in an existing state object reads as null', () => {
  const {result} = renderHook(() => ({
    a: useHistoryScrollState('a'),
    b: useHistoryScrollState('b'),
  }));

  // history.state is now a non-empty object — key 'a' is simply absent.
  act(() => result.current.b[1](fakeScrollState(9)));
  writesSettle();
  act(() => nav.navigate(readHistoryState()));

  expect(result.current.a[0]).toBeNull();
});

test('a write lands under its key in history.state once writes stop', () => {
  // The virtualizer reports on every scroll event, so the writes wait for a
  // pause; only the last one is stored.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  act(() => result.current[1](fakeScrollState(100)));
  vi.advanceTimersByTime(50);
  const s = fakeScrollState(123);
  act(() => result.current[1](s));
  vi.advanceTimersByTime(50);
  expect(readHistoryState()).toBeUndefined();

  writesSettle();
  expect((readHistoryState() as Record<string, unknown>).a).toEqual(s);
});

test('a write still pending when a navigation starts lands in the entry being left', () => {
  // A click while a scroll is still moving: the navigation starts before the
  // writes have paused. The entry being left has to keep where it was left,
  // and the write must not end up in the entry being entered instead.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const home = currentEntryID();
  const s = fakeScrollState(456);
  act(() => result.current[1](s));

  act(() => nav.navigate({}));
  writesSettle();
  expect(result.current[0]).toBeNull();
  expect(readHistoryState()).toEqual({});

  act(() => nav.traverse(home));
  expect(result.current[0]).toEqual(s);
});

test('a write still pending when the page goes away is stored', () => {
  // A reload from the browser's own button fires no `navigate`; `pagehide`
  // is the last word before the entry is reloaded.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const s = fakeScrollState(456);
  act(() => result.current[1](s));

  dispatchEvent(new Event('pagehide'));
  expect((readHistoryState() as Record<string, unknown>).a).toEqual(s);
});

test('a write still pending at a replace lands in the replacing entry', () => {
  // A replace discards the entry it replaces, and keeps the position (see the
  // replace test above): the write belongs to the entry that takes its place.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const s = fakeScrollState(456);
  act(() => result.current[1](s));

  act(() => nav.replace({}));
  writesSettle();
  expect((readHistoryState() as Record<string, unknown>).a).toEqual(s);
});

test('carries a start row JSON cannot serialize', () => {
  // With `compareStartRows` the core never stringifies a start row, and this
  // hook stores through structured clone — so an int64 read as a bigint goes
  // out and comes back intact. Nothing here may look inside the state.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const s = {
    ...fakeScrollState(11),
    anchor: {index: 3, kind: 'forward' as const, startRow: {rowid: 42n}},
  };

  expect(() => act(() => result.current[1](s))).not.toThrow();
  writesSettle();

  act(() => nav.navigate(readHistoryState()));
  expect(result.current[0]).toEqual(s);
});

test('a sibling key this hook does not own cannot break it', () => {
  // `history.state` is shared. Another library's key, a router's location
  // state — none of it is ours to impose a shape on, and the Navigation API
  // structured-clones, so it can hold things JSON cannot take. Reading and
  // writing our own key has to work anyway.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const cyclic: Record<string, unknown> = {rowid: 1n};
  cyclic.self = cyclic;

  act(() => nav.navigate({theirs: cyclic}));
  const s = fakeScrollState(5);

  expect(() => act(() => result.current[1](s))).not.toThrow();
  writesSettle();
  expect((readHistoryState() as Record<string, unknown>).a).toEqual(s);
  expect((readHistoryState() as Record<string, unknown>).theirs).toBeDefined();
});

test('a write does not come back as a state to restore', () => {
  // The whole point: the setter records where the viewport ended up. Handing
  // that straight back would tell the virtualizer to go there — and by the
  // time a debounced write completes its round trip, "there" can be a
  // position the viewport has already left (a scrollToItem in flight).
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const before = result.current[0];

  act(() => result.current[1](fakeScrollState(123)));

  expect(result.current[0]).toBe(before);
});

test('a navigation does come back', () => {
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const s = fakeScrollState(123);

  act(() => nav.navigate({a: s}));

  expect(result.current[0]).toEqual(s);
});

test('traversing back to an entry restores the state written while there', () => {
  // The write is invisible while we stay on the entry, but it is still
  // *stored* — coming back to that entry later is a navigation, and this is
  // the case the whole mechanism exists to serve.
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const home = currentEntryID();
  const s = fakeScrollState(456);
  act(() => result.current[1](s));
  writesSettle();
  expect(result.current[0]).toBeNull();

  act(() => nav.navigate({}));
  expect(result.current[0]).toBeNull();

  act(() => nav.traverse(home));

  expect(result.current[0]).toEqual(s);
});

test('a debounced write does not clobber sibling keys', () => {
  const {result} = renderHook(() => ({
    a: useHistoryScrollState('a'),
    b: useHistoryScrollState('b'),
  }));

  // Two virtualizers on one page, each writing its own key, with a sibling
  // key the app wrote in between: none of them may erase another.
  const setA = result.current.a[1];
  const setB = result.current.b[1];

  const stateA = fakeScrollState(1);
  const stateB = fakeScrollState(2);
  act(() => setA(stateA));
  writesSettle();
  navigation.updateCurrentEntry({
    state: {...(readHistoryState() as Record<string, unknown>), app: 1},
  });
  act(() => setB(stateB));
  writesSettle();

  // Asserted against the stored state, not the hooks' own reads: a write is
  // deliberately invisible to the hook that made it.
  const stored = readHistoryState() as Record<string, unknown>;
  expect(stored.a).toEqual(stateA);
  expect(stored.b).toEqual(stateB);
  expect(stored.app).toBe(1);
});
