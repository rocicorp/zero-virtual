import {useCallback, useMemo, useSyncExternalStore} from 'react';
import {
  getHistoryNavigationSnapshot,
  getHistoryStateServerSnapshot,
  readHistoryState,
  subscribeHistoryState,
  updateHistoryState,
} from '../core/history-state.ts';
import type {ScrollHistoryState} from '../core/types.ts';

const DEFAULT_KEY = 'scrollState';

/**
 * Hook that persists virtualizer scroll state in `window.history.state`.
 *
 * This is the standard way to integrate scroll state with browser
 * navigation. The state is stored under a configurable key in
 * `history.state`, so back/forward navigation restores scroll position
 * and pagination state automatically.
 *
 * Built on the Navigation API, which requires Firefox 147+ (all supported
 * Chromium and Safari versions have it). On older Firefox, skip this helper
 * and wire `scrollState` / `onScrollStateChange` to a persistence mechanism
 * of your own (e.g. `history.replaceState` or `sessionStorage`) — the
 * options accept any implementation.
 *
 * The returned state only changes when the *browser* navigates: a load, a
 * reload, or a back/forward. What `setState` writes does not come back
 * through it. The two directions mean different things — the setter records
 * where the viewport ended up, the state says where to put it — so echoing a
 * write back would hand the virtualizer its own history as an instruction,
 * and a position it has already moved on from is exactly the one it must not
 * be sent to. (If your app writes this key in `history.state` itself, write
 * it through `setState` and pass the value to the virtualizer directly;
 * a bare `updateCurrentEntry` is not a navigation and won't be picked up.)
 *
 * @typeParam TStartRow - The type of data needed to anchor pagination
 * @param key - The key to use in `history.state`. Defaults to `"scrollState"`.
 *   Use different keys if you have multiple virtualizers on the same page.
 * @returns A tuple of `[state, setState]` to pass to `useZeroVirtualizer`'s
 *   `scrollState` and `onScrollStateChange` props.
 *
 * @example
 * ```tsx
 * const [scrollState, setScrollState] = useHistoryScrollState<MyStartRow>();
 *
 * const {virtualizer, rowAt} = useZeroVirtualizer({
 *   scrollState,
 *   onScrollStateChange: setScrollState,
 *   // ...
 * });
 * ```
 */
export function useHistoryScrollState<TStartRow>(
  key: string = DEFAULT_KEY,
): [
  ScrollHistoryState<TStartRow> | null,
  (state: ScrollHistoryState<TStartRow> | null) => void,
] {
  // Only navigations move this — see getHistoryNavigationSnapshot.
  const state = useSyncExternalStore(
    subscribeHistoryState,
    getHistoryNavigationSnapshot,
    getHistoryStateServerSnapshot,
  );

  // `state` only moves when the browser navigated, and it holds still for
  // every write in between, so its identity is already the signal: no reason
  // to look inside it — and looking would put a JSON requirement on the
  // app's own row data that `compareStartRows` is there to lift.
  //
  // A navigation between two entries that happen to hold the same position
  // therefore restores rather than short-circuiting. That is the right way
  // round: the list may have scrolled away from what it last persisted, and
  // then the restore is exactly what is wanted.
  const scrollState: ScrollHistoryState<TStartRow> | null = useMemo(() => {
    if (!state) return null;
    return ((state as Record<string, unknown>)[key] ??
      null) as ScrollHistoryState<TStartRow> | null;
  }, [state, key]);

  const setScrollState = useCallback(
    (newState: ScrollHistoryState<TStartRow> | null) => {
      // Re-read the live history state instead of spreading the render-time
      // snapshot: the virtualizer calls this from a ~100ms persist debounce,
      // so another virtualizer (under a different key) or the app itself may
      // have written a sibling key since this closure was created — spreading
      // the stale snapshot would silently erase that write. (Mirrors the
      // Solid binding.)
      const current = readHistoryState();
      updateHistoryState({
        ...(current as Record<string, unknown>),
        [key]: newState,
      });
    },
    [key],
  );

  return [scrollState, setScrollState];
}
