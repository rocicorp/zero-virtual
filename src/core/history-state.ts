/**
 * A framework-free external store over the Navigation API's current-entry
 * state: subscribe / snapshot / update. The React wrapper bridges it with
 * `useSyncExternalStore`; the Solid wrapper with a signal.
 *
 * The Navigation API needs Firefox 147+ (all supported Chromium and Safari
 * versions have it) — see the history-state helpers' docs for the fallback
 * story on older Firefox.
 */

let currentSnapshot: unknown = null;
let currentSnapshotString = 'null';

/**
 * The current history-entry state. Cached by JSON identity so an unchanged
 * state returns the same object (required by `useSyncExternalStore`, and what
 * keeps downstream memoization stable) — which means the whole
 * `history.state`, every key of it, has to be JSON-serializable. Prefer
 * {@linkcode getHistoryNavigationSnapshot} for reading and
 * {@linkcode readHistoryState} for writing; neither has that requirement.
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

// The entry the navigation snapshot below was taken from, and that snapshot.
let navigationRead = false;
let navigationEntryID: string | undefined;
let navigationEntryKey: string | undefined;
let navigationState: unknown = null;

/**
 * The current history-entry state as of the last *navigation* — a load, a
 * reload, a push, or a traverse. A replace keeps the snapshot (see below).
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
 *
 * The id is the whole signal; the state itself is never inspected. It is a
 * whole `history.state`, most of which belongs to whoever else writes there,
 * and comparing it would mean imposing a shape on their data to answer a
 * question the id already answers. Readers that care whether their own key
 * changed across a navigation compare that key themselves.
 */
export function getHistoryNavigationSnapshot(): unknown {
  const entry = navigation.currentEntry;
  const id = entry?.id;
  if (navigationRead && id === navigationEntryID) {
    return navigationState;
  }
  // A replace swaps the entry (a new `id`) in the same slot (the same `key`).
  // It rewrites where the user is — an app keeping a filter or a setting in
  // the URL — rather than taking them somewhere, so the position on screen
  // still stands. Keep the snapshot: the state a replace carries over was
  // written for the old entry, and handed out anew it reads as an
  // instruction to go back to where it was written.
  if (
    navigationRead &&
    entry?.key !== undefined &&
    entry.key === navigationEntryKey
  ) {
    navigationEntryID = id;
    return navigationState;
  }
  navigationRead = true;
  navigationEntryID = id;
  navigationEntryKey = entry?.key;
  navigationState = entry?.getState();
  return navigationState;
}

/**
 * The live current-entry state, uncached.
 *
 * For read-modify-write: a caller that is about to write one key back has to
 * see the writes that came after the last snapshot — including its own — or
 * it erases them. It also wants nothing to do with the identity caching
 * above, which exists for readers and would make this read a `history.state`
 * it cannot serialize on someone else's behalf.
 */
export function readHistoryState(): unknown {
  return navigation.currentEntry?.getState();
}

/** Server-side snapshot (no Navigation API): always null. */
export function getHistoryStateServerSnapshot(): unknown {
  return null;
}

/** Replace the current history entry's state. */
export function updateHistoryState(state: unknown): void {
  navigation.updateCurrentEntry({state});
}

// How long `writeHistoryState` waits for writes to stop before storing them.
const WRITE_DEBOUNCE_MS = 100;

// Writes waiting out the debounce, by key.
const pendingWrites = new Map<string, unknown>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Set one key of the current entry's state, leaving its sibling keys alone.
 *
 * Debounced, because a virtualizer reports its position on every scroll
 * event. The pending write goes out early when a navigation starts:
 * `navigate` fires while the entry being left is still the current one, so
 * it keeps the position it was left at. Without that, a click while a scroll
 * is still moving would leave it holding wherever the list was before that
 * scroll began, and the write would land in the next entry instead. It also
 * goes out on `pagehide`, for the ones `navigate` doesn't announce: a reload
 * from the browser's own button, say.
 */
export function writeHistoryState(key: string, value: unknown): void {
  pendingWrites.set(key, value);
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushHistoryWrites, WRITE_DEBOUNCE_MS);
  navigation.addEventListener('navigate', onNavigate);
  addEventListener('pagehide', flushHistoryWrites);
}

function onNavigate(e: NavigateEvent): void {
  // A replace keeps the position (see getHistoryNavigationSnapshot), and the
  // entry it replaces is about to be discarded: what is pending belongs to
  // the replacing entry, so it waits for that one.
  if (e.navigationType !== 'replace') flushHistoryWrites();
}

function flushHistoryWrites(): void {
  clearTimeout(writeTimer);
  navigation.removeEventListener('navigate', onNavigate);
  removeEventListener('pagehide', flushHistoryWrites);
  // The live state, not a snapshot: this is a read-modify-write over sibling
  // keys — another virtualizer's, the app's own — so it has to see every
  // write that came after the last navigation.
  const state = {...(readHistoryState() as Record<string, unknown>)};
  for (const [key, value] of pendingWrites) state[key] = value;
  pendingWrites.clear();
  updateHistoryState(state);
}

/** Listen for current-entry changes; returns an unsubscribe fn. */
export function subscribeHistoryState(onStoreChange: () => void): () => void {
  navigation.addEventListener('currententrychange', onStoreChange);
  return () =>
    navigation.removeEventListener('currententrychange', onStoreChange);
}
