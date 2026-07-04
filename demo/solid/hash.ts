import {createSignal, onCleanup, type Accessor} from 'solid-js';

/**
 * The current URL hash (without the leading `#`) as a signal, plus a setter.
 * Solid mirror of the React demo's `useHash`: tracks changes via the
 * Navigation API and intercepts same-document hash navigations with
 * `scroll: 'manual'` so the browser's native fragment scroll doesn't fight
 * the virtualizer's own permalink/restore scrolling.
 *
 * Call during component setup (uses `onCleanup`).
 */
export function createHash(): [Accessor<string>, (hash: string) => void] {
  const [hash, setHashSignal] = createSignal(location.hash.slice(1));

  const onNavigate = (e: NavigateEvent) => {
    if (e.canIntercept && navigation.currentEntry?.url) {
      e.intercept({scroll: 'manual'});
      const currentURL = new URL(navigation.currentEntry.url);
      const destinationURL = new URL(e.destination.url);
      if (currentURL.pathname === destinationURL.pathname) {
        setHashSignal(destinationURL.hash.slice(1));
      }
    }
  };

  navigation.addEventListener('navigate', onNavigate);
  onCleanup(() => navigation.removeEventListener('navigate', onNavigate));

  const setHash = (newHash: string) => {
    navigation.navigate(location.pathname + location.search + '#' + newHash);
  };

  return [hash, setHash];
}
