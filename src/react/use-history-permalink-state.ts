import {useCallback, useSyncExternalStore} from 'react';
import type {PermalinkHistoryState} from './use-zero-virtualizer.ts';

const DEFAULT_KEY = 'permalinkState';

/**
 * Hook that persists virtualizer permalink state in `window.history.state`.
 *
 * This is the standard way to integrate permalink state with browser
 * navigation. The state is stored under a configurable key in
 * `history.state`, so back/forward navigation restores scroll position
 * and pagination state automatically.
 *
 * @typeParam TStartRow - The type of data needed to anchor pagination
 * @param key - The key to use in `history.state`. Defaults to `"permalinkState"`.
 *   Use different keys if you have multiple virtualizers on the same page.
 * @returns A tuple of `[state, setState]` to pass to `useZeroVirtualizer`'s
 *   `permalinkState` and `onPermalinkStateChange` props.
 *
 * @example
 * ```tsx
 * const [permalinkState, setPermalinkState] = useHistoryPermalinkState<MyStartRow>();
 *
 * const {virtualizer, rowAt} = useZeroVirtualizer({
 *   permalinkState,
 *   onPermalinkStateChange: setPermalinkState,
 *   // ...
 * });
 * ```
 */
export function useHistoryPermalinkState<TStartRow>(
  key: string = DEFAULT_KEY,
): [
  PermalinkHistoryState<TStartRow> | null,
  (state: PermalinkHistoryState<TStartRow>) => void,
] {
  const state = useSyncExternalStore(
    subscribeToPopState,
    () => getSnapshot<TStartRow>(key),
    () => null,
  );

  const setState = useCallback(
    (newState: PermalinkHistoryState<TStartRow>) => {
      window.history.replaceState(
        {...window.history.state, [key]: newState},
        '',
      );
    },
    [key],
  );

  return [state, setState];
}

function subscribeToPopState(onStoreChange: () => void) {
  window.addEventListener('popstate', onStoreChange);
  return () => window.removeEventListener('popstate', onStoreChange);
}

function getSnapshot<TStartRow>(key: string) {
  return (
    (window.history.state?.[key] as PermalinkHistoryState<TStartRow>) ?? null
  );
}
