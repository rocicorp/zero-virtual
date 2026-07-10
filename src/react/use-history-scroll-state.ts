import {useCallback, useMemo} from 'react';
import {getHistoryStateSnapshot} from '../core/history-state.ts';
import {useHistoryState} from './use-history-state.ts';
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
  const [state, setState] = useHistoryState();

  const scrollState: ScrollHistoryState<TStartRow> | null = useMemo(() => {
    if (!state) return null;
    return ((state as Record<string, unknown>)[key] ??
      null) as ScrollHistoryState<TStartRow> | null;
  }, [state && JSON.stringify((state as Record<string, unknown>)[key])]);

  const setScrollState = useCallback(
    (newState: ScrollHistoryState<TStartRow> | null) => {
      // Re-read the live history state instead of spreading the render-time
      // snapshot: the virtualizer calls this from a ~100ms persist debounce,
      // so another virtualizer (under a different key) or the app itself may
      // have written a sibling key since this closure was created — spreading
      // the stale snapshot would silently erase that write. (Mirrors the
      // Solid binding.)
      const current = getHistoryStateSnapshot();
      setState({
        ...(current as Record<string, unknown>),
        [key]: newState,
      });
    },
    [setState, key],
  );

  return [scrollState, setScrollState];
}
