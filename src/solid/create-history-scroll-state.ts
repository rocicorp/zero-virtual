import {createMemo, createSignal, onCleanup, type Accessor} from 'solid-js';
import {
  getHistoryStateSnapshot,
  subscribeHistoryState,
  updateHistoryState,
} from '../core/history-state.ts';
import type {ScrollHistoryState} from '../core/types.ts';

const DEFAULT_KEY = 'scrollState';

/**
 * Persists virtualizer scroll state in `window.history.state` (Solid mirror
 * of the React `useHistoryScrollState`). The state is stored under a
 * configurable key, so back/forward navigation restores scroll position and
 * pagination state automatically.
 *
 * Call during component setup (uses `onCleanup`).
 *
 * @param key - The key to use in `history.state`. Defaults to `"scrollState"`.
 * @returns `[state, setState]` to pass to `createZeroVirtualizer`'s
 *   `scrollState` and `onScrollStateChange` options.
 */
export function createHistoryScrollState<TStartRow>(
  key: string = DEFAULT_KEY,
): [
  Accessor<ScrollHistoryState<TStartRow> | null>,
  (state: ScrollHistoryState<TStartRow> | null) => void,
] {
  const [raw, setRaw] = createSignal<unknown>(getHistoryStateSnapshot());
  onCleanup(
    subscribeHistoryState(() => setRaw(() => getHistoryStateSnapshot())),
  );

  // Memoized by JSON identity (matching the React hook), so an unrelated
  // history-state change doesn't produce a new scroll-state reference.
  const scrollState = createMemo<ScrollHistoryState<TStartRow> | null>(
    () => {
      const state = raw();
      if (!state) return null;
      return ((state as Record<string, unknown>)[key] ??
        null) as ScrollHistoryState<TStartRow> | null;
    },
    null,
    {equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)},
  );

  const setScrollState = (newState: ScrollHistoryState<TStartRow> | null) => {
    const state = getHistoryStateSnapshot();
    updateHistoryState({
      ...((state as Record<string, unknown>) ?? {}),
      [key]: newState,
    });
  };

  return [scrollState, setScrollState];
}
