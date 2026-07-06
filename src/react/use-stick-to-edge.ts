import {useLayoutEffect, useRef} from 'react';
import {
  contentGrowthDeps,
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
 *   `virtualizer.options` / `virtualizer.scrollElement`), and its
 *   items/spacers drive the re-pinning.
 * @param deps Extra values that change when content can grow at the bottom in
 *   ways the items/spacers don't capture (e.g. the last row streaming in
 *   taller). Must keep a stable length across renders, like hook deps.
 */
export function useStickToBottom<TRow>(
  virtualizer: ZeroVirtualizerResult<TRow>,
  {enabled = true, slack = DEFAULT_STICK_SLACK}: StickOptions = {},
  deps: ReadonlyArray<unknown> = [],
): void {
  const ref = useRef<StickToBottomCache | null>(null);

  // Runs per content tick, pre-paint. The content deps are deliberately in
  // the deps: when the scroll container renders conditionally,
  // `scrollElement` can be null at first and nothing else would re-run — the
  // controller attaches lazily on each tick until the element exists.
  useLayoutEffect(() => {
    if (!enabled) {
      ref.current?.detach();
      return;
    }
    (ref.current ??= createStickToBottomCache()).ensure(virtualizer, slack);
  }, [
    ...contentGrowthDeps(virtualizer),
    ...deps,
    enabled,
    virtualizer.options,
    slack,
  ]);

  useLayoutEffect(
    () => () => {
      ref.current?.detach();
      ref.current = null;
    },
    [],
  );
}
