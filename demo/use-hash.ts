import {useSyncExternalStore} from 'react';

// Module-level cache updated immediately when a currententrychange event fires
// so that getHash() always returns the correct value when React reads it
// synchronously after the subscriber notifies it.
let currentHash = location.hash.slice(1);

function getHash(): string {
  return currentHash;
}

function subscribe(callback: () => void): () => void {
  const onNavigate = (e: NavigateEvent) => {
    if (e.canIntercept && navigation.currentEntry?.url) {
      e.intercept();
      const currentURL = new URL(navigation.currentEntry.url);
      const destinationURL = new URL(e.destination.url);
      if (currentURL.pathname === destinationURL.pathname) {
        const newHash = destinationURL.hash.slice(1);
        if (newHash !== currentHash) {
          currentHash = newHash;
          callback();
        }
      }
    }
  };

  navigation.addEventListener('navigate', onNavigate);
  return () => navigation.removeEventListener('navigate', onNavigate);
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
