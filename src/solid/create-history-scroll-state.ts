import {createMemo, createSignal, onCleanup, type Accessor} from 'solid-js';
import {
  getHistoryNavigationSnapshot,
  readHistoryState,
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
 * Built on the Navigation API, which requires Firefox 147+ (all supported
 * Chromium and Safari versions have it). On older Firefox, skip this helper
 * and wire `scrollState` / `onScrollStateChange` to a persistence mechanism
 * of your own (e.g. `history.replaceState` or `sessionStorage`) — the
 * options accept any implementation.
 *
 * The returned accessor only changes when the *browser* navigates: a load, a
 * reload, or a back/forward. What `setState` writes does not come back
 * through it — see the React `useHistoryScrollState` for why the two
 * directions must not be joined up.
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
  // Only navigations move this — see getHistoryNavigationSnapshot.
  const [raw, setRaw] = createSignal<unknown>(getHistoryNavigationSnapshot());
  onCleanup(
    subscribeHistoryState(() => setRaw(() => getHistoryNavigationSnapshot())),
  );

  // Identity, not content (matching the React hook): `raw()` only moves when
  // the browser navigated, so it is already the signal, and looking inside it
  // would put a JSON requirement on the app's own row data.
  const scrollState = createMemo<ScrollHistoryState<TStartRow> | null>(() => {
    const state = raw();
    if (!state) return null;
    return ((state as Record<string, unknown>)[key] ??
      null) as ScrollHistoryState<TStartRow> | null;
  });

  const setScrollState = (newState: ScrollHistoryState<TStartRow> | null) => {
    // The live state, not the navigation snapshot: this is a read-modify-write
    // over sibling keys, so it has to see writes that came after the last
    // navigation — including our own.
    const state = readHistoryState();
    updateHistoryState({
      ...(state as Record<string, unknown>),
      // Zero's Solid useQuery hands out store proxies, and the anchor's start
      // row is taken straight from a query row — so the state can contain a
      // proxy, which the Navigation API's structured clone rejects. Round-trip
      // through JSON to get plain data (this module already defines state
      // identity by JSON, see the equality memo above).
      [key]: newState && JSON.parse(JSON.stringify(newState)),
    });
  };

  return [scrollState, setScrollState];
}
