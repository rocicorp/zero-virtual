import type {ReactNode} from 'react';
import {App} from './App.tsx';
import {useUrlState} from './use-url-state.ts';
import {WindowList} from './WindowList.tsx';

/**
 * Top-level router: renders the element-scrolling demo or the window-scrolling
 * demo based on the `scroller` URL query param, so switching between them (and a
 * reload) is preserved. The switch itself lives in the DevPanel's `container`
 * select.
 */
export function Demo(): ReactNode {
  const [scroller] = useUrlState('scroller', 'element');
  return scroller === 'window' ? <WindowList /> : <App />;
}
