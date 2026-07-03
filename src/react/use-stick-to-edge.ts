import {useEffect, useLayoutEffect, useRef} from 'react';
import {
  elementScrollAdapter,
  type ScrollAdapter,
} from './use-zero-virtualizer.ts';

/**
 * Slack (px) around the bottom edge so sub-pixel rounding or a stray fractional
 * scroll position doesn't count as "not at the bottom" and unstick you.
 */
const DEFAULT_SLACK = 4;

export type StickOptions = {
  /**
   * Turn the behavior on/off without violating the rules of hooks (call the
   * hook unconditionally, flip this instead). Defaults to `true`.
   */
  enabled?: boolean | undefined;
  /** Px of slack around the edge (see {@link DEFAULT_SLACK}). */
  slack?: number | undefined;
  /**
   * How the scroll container is read and driven — pass the same adapter the
   * virtualizer uses ({@linkcode elementScrollAdapter} by default,
   * {@linkcode windowScrollAdapter} for a window scroller).
   */
  adapter?: ScrollAdapter | undefined;
};

/**
 * Stick-to-bottom: when content grows, keep the viewport pinned to the bottom
 * — but only if the user was already parked there. The building block for a
 * chat / log UI.
 *
 * This is a thin layer on top of scroll anchoring, not a replacement for it.
 * Anchoring keeps the view stable when off-screen content above changes (e.g.
 * loading older messages); the one thing it never does is *follow* new content
 * arriving at the bottom edge. That's this. Scroll away from the bottom and
 * the following stops (read history in peace); scroll back and it re-arms.
 *
 * There is deliberately no stick-to-*top* twin: scroll anchoring is suppressed
 * at scroll offset 0 (natively per the CSS spec, and the manual mode matches),
 * so content prepended while you're at the very top is already revealed.
 *
 * @param getScrollElement Returns the scroll container — the same element the
 *   virtualizer's `getScrollElement` returns.
 * @param dep A value that changes whenever the content can grow at the bottom
 *   (e.g. the newest row's key, the row count, or a measurement tick). The
 *   re-pin runs after each change, so it also re-sticks as dynamic rows settle.
 */
export function useStickToBottom(
  getScrollElement: () => HTMLElement | null,
  dep: unknown,
  {
    enabled = true,
    slack = DEFAULT_SLACK,
    adapter = elementScrollAdapter,
  }: StickOptions = {},
): void {
  // Whether the user is currently parked at the bottom. Updated on every
  // scroll (i.e. *before* the content grows), so at grow-time it reflects the
  // pre-growth position — which is the whole trick. Starts false (never yank
  // a restored scroll position); the first measurement decides, and a freshly
  // mounted short list measures as at-bottom, so a chat still starts stuck.
  const stuckRef = useRef(false);

  // `dep` is deliberately in the deps: when the scroll container renders
  // conditionally, `getScrollElement()` can be null on the first pass and
  // nothing else here would ever re-run — the listener would never attach.
  // Re-running per content tick guarantees we attach (and re-measure) once
  // the element exists; the re-subscription is cheap.
  useEffect(() => {
    const el = getScrollElement();
    if (!el || !enabled) return undefined;
    const scroller = adapter.scrollElement(el);
    const measure = () => {
      stuckRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
        slack;
    };
    measure();
    return adapter.subscribe(el, measure, () => {});
  }, [getScrollElement, adapter, slack, enabled, dep]);

  // After the content grows, snap back to the bottom if we were parked there.
  // Layout effect (not passive) so it happens before paint — no flash of the
  // un-followed position.
  useLayoutEffect(() => {
    if (!enabled || !stuckRef.current) return;
    const el = getScrollElement();
    if (!el) return;
    const scroller = adapter.scrollElement(el);
    scroller.scrollTop = scroller.scrollHeight;
  }, [dep, getScrollElement, adapter, enabled]);
}
