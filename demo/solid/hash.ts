import {createSignal, onCleanup, type Accessor} from 'solid-js';

/**
 * The current URL hash (without the leading `#`) as a signal, plus a setter.
 * Solid mirror of the React demo's `useHash`: tracks changes via the
 * Navigation API and intercepts same-document navigations with
 * `scroll: 'manual'` so the browser's native fragment scroll doesn't fight
 * the virtualizer's own permalink/restore scrolling.
 *
 * Call during component setup (uses `onCleanup`).
 */
export function createHash(): [Accessor<string>, (hash: string) => void] {
  const [hash, setHashSignal] = createSignal(location.hash.slice(1));
  // The path the hash belongs to (see onCurrentEntryChange).
  let currentPath = location.pathname;

  const onNavigate = (e: NavigateEvent) => {
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
  };

  // Read on `currententrychange` rather than in the `navigate` handler above:
  // that one runs *before* the entry commits, while the history entry — and
  // so the virtualizer's scroll state — is still the old one. The virtualizer
  // reads `permalinkID` and `scrollState` as one intent, and handing it the
  // new hash with the old state makes it restore the position it is on its
  // way out of. `createHistoryScrollState` reads the entry when called, so
  // the update this sets off sees the new entry's state with the new hash.
  const onCurrentEntryChange = () => {
    const previousPath = currentPath;
    currentPath = location.pathname;
    // A navigation that changed the path is another page's business. Its
    // fragment means whatever that page says it means, and adopting it here
    // would hand this list a permalink id belonging to something else.
    if (currentPath !== previousPath) return;
    setHashSignal(location.hash.slice(1));
  };

  navigation.addEventListener('navigate', onNavigate);
  navigation.addEventListener('currententrychange', onCurrentEntryChange);
  onCleanup(() => {
    navigation.removeEventListener('navigate', onNavigate);
    navigation.removeEventListener('currententrychange', onCurrentEntryChange);
  });

  const setHash = (newHash: string) => {
    navigation.navigate(location.pathname + location.search + '#' + newHash);
  };

  return [hash, setHash];
}
