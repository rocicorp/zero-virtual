/**
 * A framework-free external store over the Navigation API's current-entry
 * state: subscribe / snapshot / update. The React wrapper bridges it with
 * `useSyncExternalStore`; the Solid wrapper with a signal.
 */

let currentSnapshot: unknown = null;
let currentSnapshotString = 'null';

/**
 * The current history-entry state. Cached by JSON identity so an unchanged
 * state returns the same object (required by `useSyncExternalStore`, and what
 * keeps downstream memoization stable).
 */
export function getHistoryStateSnapshot(): unknown {
  const newSnapshot = navigation.currentEntry?.getState();
  const newSnapshotString = JSON.stringify(newSnapshot);
  if (newSnapshotString !== currentSnapshotString) {
    currentSnapshot = newSnapshot;
    currentSnapshotString = newSnapshotString;
  }
  return currentSnapshot;
}

/** Server-side snapshot (no Navigation API): always null. */
export function getHistoryStateServerSnapshot(): unknown {
  return null;
}

/** Replace the current history entry's state. */
export function updateHistoryState(state: unknown): void {
  navigation.updateCurrentEntry({state});
}

/** Listen for current-entry changes; returns an unsubscribe fn. */
export function subscribeHistoryState(onStoreChange: () => void): () => void {
  navigation.addEventListener('currententrychange', onStoreChange);
  return () =>
    navigation.removeEventListener('currententrychange', onStoreChange);
}
