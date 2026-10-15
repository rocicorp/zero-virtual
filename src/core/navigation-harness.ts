// Minimal Navigation API stub (happy-dom doesn't implement it): current-entry
// state, id and key, plus `navigate` and `currententrychange`, which is all
// core/history-state.ts uses. `id` and `key` matter — they are how the store
// tells a navigation from an in-place state write, and a replace from both,
// so the stub has to set them the way the real API does: a new id on a new or
// replaced entry, never on updateCurrentEntry; a new key only on a new entry.
// So does the order: `navigate` fires while the entry being left is still the
// current one, `currententrychange` once the new one is.

export type NavigationStub = {
  /** Navigate to a fresh entry carrying `state` (push / load / reload). */
  navigate: (state: unknown) => void;
  /** Replace the current entry with one carrying `state`. */
  replace: (state: unknown) => void;
  /** Traverse to a previously visited entry, by its id. */
  traverse: (id: string) => void;
  /** The id of the entry the stub is currently on. */
  currentEntryID: () => string;
};

let nextEntryID = 0;

/** Installs a fresh stub as `globalThis.navigation`, on a first entry. */
export function installNavigationStub(): NavigationStub {
  const entries = new Map<string, unknown>();
  const keys = new Map<string, string>();
  let currentID = '';
  const listeners = new Set<() => void>();
  const navigateListeners = new Set<(e: {navigationType: string}) => void>();
  const navigateEvent = (navigationType: string) => {
    for (const listener of navigateListeners) listener({navigationType});
  };

  const newEntry = (state: unknown, key = `k${nextEntryID + 1}`) => {
    currentID = `e${++nextEntryID}`;
    entries.set(currentID, state);
    keys.set(currentID, key);
  };
  newEntry(undefined);

  (globalThis as {navigation?: unknown}).navigation = {
    get currentEntry() {
      return {
        id: currentID,
        key: keys.get(currentID),
        getState: () => entries.get(currentID),
      };
    },
    updateCurrentEntry({state}: {state: unknown}) {
      // The real API structured-clones the state, and leaves the entry's id
      // alone: this is not a navigation.
      entries.set(currentID, structuredClone(state));
      for (const listener of listeners) listener();
    },
    addEventListener(type: string, listener: () => void) {
      (type === 'navigate' ? navigateListeners : listeners).add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      (type === 'navigate' ? navigateListeners : listeners).delete(listener);
    },
  };

  return {
    navigate: state => {
      navigateEvent('push');
      newEntry(structuredClone(state));
      for (const listener of listeners) listener();
    },
    replace: state => {
      navigateEvent('replace');
      newEntry(structuredClone(state), keys.get(currentID));
      for (const listener of listeners) listener();
    },
    traverse: id => {
      navigateEvent('traverse');
      currentID = id;
      for (const listener of listeners) listener();
    },
    currentEntryID: () => currentID,
  };
}
