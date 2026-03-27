import {useSyncExternalStore} from 'react';

/**
 * A React hook that provides access to the Navigation API's current entry state,
 * synchronized with React's rendering cycle via `useSyncExternalStore`.
 *
 * Returns a tuple of the current history state and a setter function that calls
 * `navigation.updateCurrentEntry` to update it.
 */
export function useHistoryState(): [
  state: unknown,
  setState: (state: unknown) => void,
] {
  const state = useSyncExternalStore(
    subscribeState,
    getSnapshot,
    getServerSnapshot,
  );

  return [state, updateCurrentEntryState];
}

let currentSnapshot: unknown = null;
let currentSnapshotString = 'null';

function getSnapshot(): unknown {
  const newSnapshot = navigation.currentEntry?.getState();
  const newSnapshotString = JSON.stringify(newSnapshot);
  if (newSnapshotString !== currentSnapshotString) {
    currentSnapshot = newSnapshot;
    currentSnapshotString = newSnapshotString;
  }
  return currentSnapshot;
}

function getServerSnapshot() {
  return null;
}

function updateCurrentEntryState(state: unknown) {
  navigation.updateCurrentEntry({state});
}

function subscribeState(onStoreChange: () => void) {
  navigation.addEventListener('currententrychange', onStoreChange);
  return () =>
    navigation.removeEventListener('currententrychange', onStoreChange);
}
