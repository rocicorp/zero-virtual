import {useCallback, useMemo} from 'react';
import {useHistoryState} from './use-history-state.ts';
import type {ScrollHistoryState} from './use-zero-virtualizer.ts';

const DEFAULT_KEY = 'scrollState';

/**
 * Hook that persists virtualizer scroll state in `window.history.state`.
 *
 * This is the standard way to integrate scroll state with browser
 * navigation. The state is stored under a configurable key in
 * `history.state`, so back/forward navigation restores scroll position
 * and pagination state automatically.
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
    return (state as Record<string, unknown>)[
      key
    ] as ScrollHistoryState<TStartRow> | null;
  }, [state && JSON.stringify((state as Record<string, unknown>)[key])]);

  const setScrollState = useCallback(
    (newState: ScrollHistoryState<TStartRow> | null) => {
      setState({
        ...(state ?? {}),
        [key]: newState,
      });
    },
    [state, key],
  );

  return [scrollState, setScrollState];
}
