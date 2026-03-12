import {useSyncExternalStore} from 'react';
import {navigation, subscribeToNavigation} from '../src/react/navigation.ts';

function getHash(): string {
  const url = navigation.currentEntry?.url;
  return url ? new URL(url).hash.slice(1) : location.hash.slice(1);
}

function setHash(newHash: string) {
  navigation.navigate(location.pathname + location.search + '#' + newHash);
}

/**
 * Returns the current URL hash (without the leading `#`) and a setter function.
 * Uses the Navigation API to reactively track hash changes.
 *
 * @returns `[hash, setHash]` – the current hash value and a function to update it.
 */
export function useHash(): [string, (hash: string) => void] {
  const hash = useSyncExternalStore(subscribeToNavigation, getHash);
  return [hash, setHash];
}
