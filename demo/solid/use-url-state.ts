import {createSignal, onCleanup} from 'solid-js';
import {setUrlParams} from '../shared/url-params.ts';

/**
 * Like {@linkcode createUrlState}, for parameters a navigation sets together:
 * read as one value, so they change in one update rather than one at a time.
 */
export function createUrlParams<T>(
  read: (params: URLSearchParams) => T,
  equals: (a: T, b: T) => boolean,
): () => T {
  const get = () => read(new URLSearchParams(location.search));
  const [value, setValue] = createSignal(get(), {equals});
  const onEntryChange = () => setValue(() => get());
  navigation.addEventListener('currententrychange', onEntryChange);
  onCleanup(() =>
    navigation.removeEventListener('currententrychange', onEntryChange),
  );
  return value;
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
