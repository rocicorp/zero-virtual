/**
 * A framework-free external store over the Navigation API's current-entry
 * state: subscribe / snapshot / update. The React wrapper bridges it with
 * `useSyncExternalStore`; the Solid wrapper with a signal.
 *
 * The Navigation API needs Firefox 147+ (all supported Chromium and Safari
 * versions have it) — see the history-state helpers' docs for the fallback
 * story on older Firefox.
 */

import {valueKey} from './value-key.ts';

let currentSnapshot: unknown = null;
let currentSnapshotString = 'null';

/**
 * The current history-entry state. Cached by value ({@linkcode valueKey}) so
 * an unchanged state returns the same object (required by `useSyncExternalStore`, and what
 * keeps downstream memoization stable).
 */
export function getHistoryStateSnapshot(): unknown {
  const newSnapshot = navigation.currentEntry?.getState();
  const newSnapshotString = valueKey(newSnapshot);
  if (newSnapshotString !== currentSnapshotString) {
    currentSnapshot = newSnapshot;
    currentSnapshotString = newSnapshotString;
  }
  return currentSnapshot;
}

// The entry the navigation snapshot below was taken from, and that snapshot.
let navigationRead = false;
let navigationEntryID: string | undefined;
let navigationState: unknown = null;
let navigationStateString = 'null';

/**
 * The current history-entry state as of the last *navigation* — a load, a
 * reload, a push/replace, or a traverse.
 *
 * {@linkcode updateHistoryState} changes the current entry's state in place
 * *without* navigating: same entry, new state. A reader that treats that as
 * the host asking for a state to be applied is reading its own write back —
 * and a write that is a record of where the viewport just went, applied as an
 * instruction of where to put it, arrives a beat too late to be anything but
 * wrong.
 *
 * The entry's `id` is what tells the two apart: it is regenerated whenever the
 * entry is replaced or a new one is created, and left alone by an in-place
 * state update. So this returns the same object — identity included — for
 * every state-only write, and re-reads only when the entry underneath has
 * actually changed.
 */
export function getHistoryNavigationSnapshot(): unknown {
  const entry = navigation.currentEntry;
  const id = entry?.id;
  if (navigationRead && id === navigationEntryID) {
    return navigationState;
  }
  navigationRead = true;
  navigationEntryID = id;
  const next = entry?.getState();
  const nextString = valueKey(next);
  if (nextString !== navigationStateString) {
    navigationState = next;
    navigationStateString = nextString;
  }
  return navigationState;
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
