import {createComputed, createRoot, createSignal} from 'solid-js';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {installNavigationStub} from '../core/navigation-harness.ts';
import type {ScrollHistoryState} from '../core/types.ts';
import {createHistoryScrollState} from './create-history-scroll-state.ts';

let navigate: (state: unknown) => void;

beforeEach(() => {
  vi.useFakeTimers();
  ({navigate} = installNavigationStub());
});

afterEach(() => {
  // Let a write still pending land here rather than in the next test's stub.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function savedAt(scrollTop: number): ScrollHistoryState<unknown> {
  return {
    anchor: {index: 0, kind: 'forward', startRow: undefined},
    scrollTop,
    estimatedTotal: 100,
    hasReachedStart: true,
    hasReachedEnd: false,
    listContextParams: {},
  };
}

test("an update another navigation listener sets off sees the new entry's state", () => {
  // The app's own URL signal, updated by a `currententrychange` listener
  // added before the helper's — as the Solid demo's hash is. Whatever it sets
  // off must read this navigation's state with it, never the new URL with
  // the previous entry's state.
  const seen = createRoot(dispose => {
    const [url, setURL] = createSignal('#a');
    let nextURL = '#a';
    (
      globalThis as unknown as {
        navigation: {addEventListener(t: string, l: () => void): void};
      }
    ).navigation.addEventListener('currententrychange', () => setURL(nextURL));
    const [scrollState] = createHistoryScrollState();
    const seen: string[] = [];
    createComputed(() =>
      seen.push(`${url()} ${scrollState()?.scrollTop ?? null}`),
    );

    nextURL = '#b';
    navigate({scrollState: savedAt(300)});
    dispose();
    return seen;
  });

  // The helper's own listener runs it again with the same pair. What must
  // never show up is `#b null`: the new URL with the previous entry's state.
  expect([...new Set(seen)]).toEqual(['#a null', '#b 300']);
});

test('an in-place write does not come back through it', () => {
  createRoot(dispose => {
    const [scrollState, setScrollState] = createHistoryScrollState();
    navigate({scrollState: savedAt(300)});
    const restored = scrollState();
    expect(restored?.scrollTop).toBe(300);

    setScrollState(savedAt(900));
    expect(scrollState()).toBe(restored);

    navigate({scrollState: savedAt(50)});
    expect(scrollState()?.scrollTop).toBe(50);
    dispose();
  });
});
