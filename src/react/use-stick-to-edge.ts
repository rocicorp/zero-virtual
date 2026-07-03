import {useLayoutEffect, useRef} from 'react';
import {
  elementScrollAdapter,
  type ScrollAdapter,
} from '../core/scroll-adapter.ts';
import {
  createStickToBottom,
  DEFAULT_STICK_SLACK,
  type StickToBottomController,
} from '../core/stick-to-bottom.ts';

export type StickOptions = {
  /**
   * Turn the behavior on/off without violating the rules of hooks (call the
   * hook unconditionally, flip this instead). Defaults to `true`.
   */
  enabled?: boolean | undefined;
  /** Px of slack around the edge (defaults to {@link DEFAULT_STICK_SLACK}). */
  slack?: number | undefined;
  /**
   * How the scroll container is read and driven — pass the same adapter the
   * virtualizer uses ({@linkcode elementScrollAdapter} by default,
   * `windowScrollAdapter` for a window scroller).
   */
  adapter?: ScrollAdapter | undefined;
};

/**
 * Stick-to-bottom: when content grows, keep the viewport pinned to the bottom
 * — but only if the user was already parked there. The building block for a
 * chat / log UI. Thin React binding over the core
 * {@linkcode createStickToBottom} controller.
 *
 * This is a thin layer on top of scroll anchoring, not a replacement for it.
 * Anchoring keeps the view stable when off-screen content above changes; the
 * one thing it never does is *follow* new content arriving at the bottom
 * edge. That's this. There is deliberately no stick-to-*top* twin: scroll
 * anchoring is suppressed at scroll offset 0 (natively per the CSS spec, and
 * the manual mode matches), so content prepended while you're at the very top
 * is already revealed.
 *
 * @param getScrollElement Returns the scroll container — the same element the
 *   virtualizer's `getScrollElement` returns.
 * @param dep A value that changes whenever the content can grow at the bottom
 *   (e.g. the newest row's key, the row count, or a measurement tick).
 */
export function useStickToBottom(
  getScrollElement: () => HTMLElement | null,
  dep: unknown,
  {
    enabled = true,
    slack = DEFAULT_STICK_SLACK,
    adapter = elementScrollAdapter,
  }: StickOptions = {},
): void {
  const ref = useRef<{
    controller: StickToBottomController;
    key: readonly [() => HTMLElement | null, ScrollAdapter, number];
  } | null>(null);

  // Runs per content tick, pre-paint. `dep` is deliberately in the deps: when
  // the scroll container renders conditionally, `getScrollElement()` can be
  // null at first and nothing else would re-run — the controller attaches
  // lazily on each tick until the element exists.
  useLayoutEffect(() => {
    if (!enabled) {
      ref.current?.controller.detach();
      ref.current = null;
      return;
    }
    const key = [getScrollElement, adapter, slack] as const;
    if (
      !ref.current ||
      ref.current.key[0] !== key[0] ||
      ref.current.key[1] !== key[1] ||
      ref.current.key[2] !== key[2]
    ) {
      ref.current?.controller.detach();
      ref.current = {
        controller: createStickToBottom(getScrollElement, adapter, slack),
        key,
      };
    }
    ref.current.controller.contentChanged();
  }, [dep, enabled, getScrollElement, adapter, slack]);

  useLayoutEffect(
    () => () => {
      ref.current?.controller.detach();
      ref.current = null;
    },
    [],
  );
}
