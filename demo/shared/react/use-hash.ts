import {useSyncExternalStore} from 'react';

// Module-level cache, updated when the current history entry changes so that
// getHash() returns the right value the moment React reads it.
let currentHash = location.hash.slice(1);
// The path those hashes belong to (see onCurrentEntryChange).
let currentPath = location.pathname;

// One listener pair for all subscribers, not one per subscriber. The cache
// above is shared, so a per-subscriber listener would let whichever one ran
// first consume the change — it updates `currentHash`, and every later
// listener sees nothing to report and notifies nobody. The components that
// did not happen to be first then keep rendering the stale hash until
// something unrelated re-renders them.
const subscribers = new Set<() => void>();

function getHash(): string {
  return currentHash;
}

function onNavigate(e: NavigateEvent): void {
  if (!e.canIntercept) return;
  // Every navigation this document can handle, not just the same-path ones:
  // intercept() is what keeps a navigation in-page at all, so declining one
  // hands it back to the browser as a full document load.
  //
  // `scroll: 'manual'` stops the browser from scrolling the document on hash
  // navigations. We manage scroll ourselves (the virtualizer scrolls the
  // permalink target into view and restores saved positions); without this,
  // in window-scroller mode the native fragment scroll fights that logic.
  e.intercept({scroll: 'manual'});
}

// Read on `currententrychange` rather than in the `navigate` handler above:
// that one runs *before* the entry commits, so notifying from it re-renders
// with the new hash while the history entry — and so the virtualizer's
// scroll state — is still the old one. The virtualizer reads `permalinkID`
// and `scrollState` as one intent, and handing it half of a navigation
// makes it restore the position it is on its way out of.
function onCurrentEntryChange(): void {
  const previousPath = currentPath;
  currentPath = location.pathname;
  // A navigation that changed the path is another page's business. Its
  // fragment means whatever that page says it means, and adopting it here
  // would hand this list a permalink id belonging to something else.
  if (currentPath !== previousPath) return;
  const newHash = location.hash.slice(1);
  if (newHash === currentHash) return;
  currentHash = newHash;
  for (const subscriber of subscribers) subscriber();
}

function subscribe(callback: () => void): () => void {
  if (subscribers.size === 0) {
    navigation.addEventListener('navigate', onNavigate);
    navigation.addEventListener('currententrychange', onCurrentEntryChange);
  }
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      navigation.removeEventListener('navigate', onNavigate);
      navigation.removeEventListener(
        'currententrychange',
        onCurrentEntryChange,
      );
    }
  };
}

function setHash(newHash: string): void {
  navigation.navigate(location.pathname + location.search + '#' + newHash);
}

function getServerSnapshot(): string {
  return '';
}

/**
 * Returns the current URL hash (without the leading `#`) and a setter function.
 * Uses the Navigation API to reactively track hash changes.
 *
 * @returns `[hash, setHash]` – the current hash value and a function to update it.
 */
export function useHash(): [string, (hash: string) => void] {
  const hash = useSyncExternalStore(subscribe, getHash, getServerSnapshot);
  return [hash, setHash];
}
