import {useCallback, useSyncExternalStore} from 'react';
import {setUrlParams} from '../shared/url-params.ts';

function subscribe(callback: () => void): () => void {
  navigation.addEventListener('currententrychange', callback);
  return () => navigation.removeEventListener('currententrychange', callback);
}

/**
 * Reads and writes a URL query parameter, reactively, via the Navigation API.
 *
 * Writing replaces the current history entry (preserving its state, so the
 * virtualizer's persisted scroll position survives) and updates the URL without
 * reloading — so the value persists across reloads and back/forward.
 *
 * @returns `[value, setValue]`.
 */
export function useUrlState(
  key: string,
  defaultValue: string,
): [string, (value: string) => void] {
  const getSnapshot = () =>
    new URLSearchParams(location.search).get(key) ?? defaultValue;
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultValue,
  );

  const setValue = useCallback(
    (v: string) => setUrlParams({[key]: v === defaultValue ? null : v}),
    [key, defaultValue],
  );

  return [value, setValue];
}
