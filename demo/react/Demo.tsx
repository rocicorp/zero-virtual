import type {ReactNode} from 'react';
import {App} from './App.tsx';
import {useUrlState} from './use-url-state.ts';

/**
 * Top-level router: renders the demo scrolling an element or the window,
 * based on the `scroller` URL query param, so switching between them (and a
 * reload) is preserved. The switch itself lives in the DevPanel's `container`
 * select. Keyed, so switching remounts the list with the other hook.
 */
export function Demo(): ReactNode {
  const [scroller] = useUrlState('scroller', 'element');
  const windowScroll = scroller === 'window';
  return <App key={scroller} windowScroll={windowScroll} />;
}
