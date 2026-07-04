import {createSignal, onCleanup} from 'solid-js';

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

  const write = (nextValue: string) => {
    const params = new URLSearchParams(location.search);
    if (nextValue === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, nextValue);
    }
    const search = params.toString();
    const url =
      location.pathname + (search ? `?${search}` : '') + location.hash;
    navigation.navigate(url, {
      history: 'replace',
      state: navigation.currentEntry?.getState(),
    });
  };

  return [value, write];
}
