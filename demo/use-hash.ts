import {useSyncExternalStore} from 'react';

interface NavigationHistoryEntry {
  url: string | null;
}

interface Navigation extends EventTarget {
  readonly currentEntry: NavigationHistoryEntry | null;
  navigate(url: string): void;
}

declare const navigation: Navigation;

function getHash(): string {
  const url = navigation.currentEntry?.url;
  return url ? new URL(url).hash.slice(1) : location.hash.slice(1);
}

function subscribe(callback: () => void): () => void {
  navigation.addEventListener('currententrychange', callback);
  return () => {
    navigation.removeEventListener('currententrychange', callback);
  };
}

function setHash(newHash: string) {
  navigation.navigate(
    location.pathname + location.search + (newHash ? '#' + newHash : ''),
  );
}

/**
 * Returns the current URL hash (without the leading `#`) and a setter function.
 * Uses the Navigation API to reactively track hash changes.
 *
 * @returns `[hash, setHash]` – the current hash value and a function to update it.
 */
export function useHash(): [string, (hash: string) => void] {
  const hash = useSyncExternalStore(subscribe, getHash);
  return [hash, setHash];
}
