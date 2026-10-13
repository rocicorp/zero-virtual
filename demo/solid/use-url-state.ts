import {createSignal, onCleanup} from 'solid-js';

/**
 * Set several URL query parameters in one replace navigation (`null` removes
 * one), keeping the entry's state — see {@linkcode createUrlState}.
 */
export function setUrlParams(updates: Record<string, string | null>): void {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  const url = location.pathname + (search ? `?${search}` : '') + location.hash;
  navigation.navigate(url, {
    history: 'replace',
    state: navigation.currentEntry?.getState(),
  });
}

function readParam(key: string, defaultValue: string): string {
  return new URLSearchParams(location.search).get(key) ?? defaultValue;
}

export function createUrlState(
  key: string,
  defaultValue: string,
): [() => string, (value: string) => void] {
  const [value, setValue] = createSignal(readParam(key, defaultValue));

  const onEntryChange = () => setValue(readParam(key, defaultValue));
  navigation.addEventListener('currententrychange', onEntryChange);
  onCleanup(() =>
    navigation.removeEventListener('currententrychange', onEntryChange),
  );

  const write = (nextValue: string) =>
    setUrlParams({[key]: nextValue === defaultValue ? null : nextValue});

  return [value, write];
}
