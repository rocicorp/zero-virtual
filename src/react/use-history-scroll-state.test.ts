import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, test} from 'vitest';
import type {ScrollHistoryState} from '../core/types.ts';
import {useHistoryScrollState} from './use-history-scroll-state.ts';

// Minimal Navigation API stub (happy-dom doesn't implement it): current-entry
// state plus currententrychange, which is all core/history-state.ts uses.
function installNavigationStub(): () => void {
  let state: unknown;
  const listeners = new Set<() => void>();
  const stub = {
    currentEntry: {
      getState: () => state,
    },
    updateCurrentEntry({state: next}: {state: unknown}) {
      // The real API structured-clones; a JSON round-trip is close enough
      // for the plain data this module stores.
      state = next === undefined ? undefined : JSON.parse(JSON.stringify(next));
      for (const listener of listeners) listener();
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
  };
  const g = globalThis as {navigation?: unknown};
  g.navigation = stub;
  return () => {
    delete g.navigation;
  };
}

let uninstall: () => void;
beforeEach(() => {
  uninstall = installNavigationStub();
});
afterEach(() => uninstall());

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

test('round-trips state under its key', () => {
  const {result} = renderHook(() => useHistoryScrollState('a'));
  const s = fakeScrollState(123);
  act(() => result.current[1](s));
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

  expect(result.current.a[0]).toEqual(stateA);
  expect(result.current.b[0]).toEqual(stateB);
});
