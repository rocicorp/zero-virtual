import {useSyncExternalStore} from 'react';
import {
  getHistoryStateServerSnapshot,
  getHistoryStateSnapshot,
  subscribeHistoryState,
  updateHistoryState,
} from '../core/history-state.ts';

/**
 * A React hook that provides access to the Navigation API's current entry
 * state, synchronized with React's rendering cycle via `useSyncExternalStore`.
 * The store itself is framework-free (see core/history-state.ts).
 *
 * Returns a tuple of the current history state and a setter function that
 * calls `navigation.updateCurrentEntry` to update it.
 */
export function useHistoryState(): [
  state: unknown,
  setState: (state: unknown) => void,
] {
  const state = useSyncExternalStore(
    subscribeHistoryState,
    getHistoryStateSnapshot,
    getHistoryStateServerSnapshot,
  );

  return [state, updateHistoryState];
}
