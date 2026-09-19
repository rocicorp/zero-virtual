import {act, renderHook} from '@testing-library/react';
import {beforeEach, expect, test} from 'vitest';
import {readHistoryState} from '../core/history-state.ts';
import type {ScrollHistoryState} from '../core/types.ts';
import {useHistoryScrollState} from './use-history-scroll-state.ts';

// Minimal Navigation API stub (happy-dom doesn't implement it): current-entry
// state and id, plus currententrychange, which is all core/history-state.ts
// uses. `id` matters — it is how the store tells a navigation from an
// in-place state write, so the stub has to regenerate it the way the real API
// does: on a new or replaced entry, never on updateCurrentEntry.
type NavigationStub = {
  /** Navigate to a fresh entry carrying `state` (push / load / reload). */
  navigate(state: unknown): void;
  /** Traverse to a previously visited entry, by the id `navigate` returned. */
  traverse(id: string): void;
};

let nav: NavigationStub;
let nextEntryID = 0;

function installNavigationStub(): void {
  const entries = new Map<string, unknown>();
  let currentID = '';
  const listeners = new Set<() => void>();

  const newEntry = (state: unknown) => {
    currentID = `e${++nextEntryID}`;
    entries.set(currentID, state);
  };
  newEntry(undefined);

  const stub = {
    get currentEntry() {
      return {
        id: currentID,
        getState: () => entries.get(currentID),
      };
    },
    updateCurrentEntry({state}: {state: unknown}) {
      // The real API structured-clones the state, and leaves the entry's id
      // alone: this is not a navigation.
      entries.set(currentID, structuredClone(state));
      for (const listener of listeners) listener();
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
  };
  (globalThis as {navigation?: unknown}).navigation = stub;

  nav = {
    navigate(state) {
      newEntry(structuredClone(state));
      for (const listener of listeners) listener();
    },
    traverse(id) {
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

beforeEach(() => installNavigationStub());

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
  act(() => nav.navigate(readHistoryState()));

  expect(result.current.a[0]).toBeNull();
});

test('a write lands under its key in history.state', () => {
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const s = fakeScrollState(123);
  act(() => result.current[1](s));
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

  // The virtualizer holds onScrollStateChange callbacks and invokes them from
  // a persist debounce, so both of these closures predate either write —
  // exactly the two-virtualizers-on-one-page timing.
  const setA = result.current.a[1];
  const setB = result.current.b[1];

  const stateA = fakeScrollState(1);
  const stateB = fakeScrollState(2);
  act(() => setA(stateA));
  act(() => setB(stateB));

  // Asserted against the stored state, not the hooks' own reads: a write is
  // deliberately invisible to the hook that made it.
  const stored = readHistoryState() as Record<string, unknown>;
  expect(stored.a).toEqual(stateA);
  expect(stored.b).toEqual(stateB);
});
