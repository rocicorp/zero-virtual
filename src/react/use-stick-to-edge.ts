import {useLayoutEffect, useRef} from 'react';
import {
  createStickToBottomCache,
  DEFAULT_STICK_SLACK,
  type StickOptions,
  type StickToBottomCache,
} from '../core/stick-to-bottom.ts';
import type {ZeroVirtualizerResult} from './use-zero-virtualizer.ts';

export type {StickOptions} from '../core/stick-to-bottom.ts';

/**
 * Stick-to-bottom: when content grows, keep the viewport pinned to the bottom
 * — but only if the user was already parked there. The building block for a
 * chat / log UI. Thin React binding over the core
 * {@linkcode createStickToBottomCache} state machine.
 *
 * The behavior is driven purely by the DOM: ResizeObservers on the rows'
 * content wrapper and the scroll container detect every change to the
 * scrollable extent — including content the virtualizer doesn't know about,
 * like the last row streaming in taller — so there is nothing to declare in
 * effect deps. This hook only wires the observers up (lazily, until the
 * elements exist).
 *
 * This is a thin layer on top of scroll anchoring, not a replacement for it.
 * Anchoring keeps the view stable when off-screen content above changes; the
 * one thing it never does is *follow* new content arriving at the bottom
 * edge. That's this. There is deliberately no stick-to-*top* twin: scroll
 * anchoring is suppressed at scroll offset 0 (natively per the CSS spec, and
 * the manual mode matches), so content prepended while you're at the very top
 * is already revealed.
 *
 * @param virtualizer The result of `useZeroVirtualizer` /
 *   `useZeroWindowVirtualizer`. It supplies the scroll wiring (via
 *   `virtualizer.options` / `virtualizer.scrollElement`); the rows' content
 *   wrapper is found in the DOM.
 */
export function useStickToBottom<TRow>(
  virtualizer: ZeroVirtualizerResult<TRow>,
  {enabled = true, slack = DEFAULT_STICK_SLACK}: StickOptions = {},
): void {
  const ref = useRef<StickToBottomCache | null>(null);

  // Runs per commit, pre-paint, with no deps on purpose: when the scroll
  // container renders conditionally (or before the first rows render) the
  // elements can be null and nothing else would re-run — ensure() retries
  // each tick until they exist, and is an identity-check no-op after that.
  useLayoutEffect(() => {
    if (!enabled) {
      ref.current?.detach();
      return;
    }
    (ref.current ??= createStickToBottomCache()).ensure(virtualizer, slack);
  });

  useLayoutEffect(
    () => () => {
      ref.current?.detach();
      ref.current = null;
    },
    [],
  );
}
