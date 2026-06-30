import {useEffect, useLayoutEffect, useRef} from 'react';

/**
 * Slack (px) around an edge so sub-pixel rounding or a stray fractional scroll
 * position doesn't count as "not at the edge" and unstick you.
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
};

// Where scroll events actually fire: the document scroller reports them on
// `window`, every other element on itself.
function scrollEventTarget(el: HTMLElement): HTMLElement | Window {
  return el === document.scrollingElement ? window : el;
}

/**
 * Follow one edge of a scroll container: when content grows, keep the viewport
 * pinned to that edge — but only if the user was already parked there.
 *
 * This is a thin layer on top of *native* scroll anchoring (`overflow-anchor`),
 * not a replacement for it. Native anchoring already keeps the view stable when
 * off-screen content above the viewport changes (e.g. loading older messages);
 * the one thing it can't do is *follow* new content arriving at an edge you're
 * sitting on. That's this: stick-to-bottom for a chat/log, stick-to-top for a
 * feed sitting at `scrollTop: 0`. When you scroll away from the edge it stops
 * following, so you can read history without being yanked back.
 *
 * Works with either of the virtualizer's anchoring modes: anchoring only
 * reacts to size changes *above* the viewport, so it never fights a stick at
 * the bottom, and both modes suppress anchoring at scroll offset 0 (native per
 * the CSS spec, manual to match), which is what lets a stick at the top hold.
 * Stick-to-top at offset 0 is in fact what suppression already gives you —
 * {@link useStickToTop} makes it explicit — while {@link useStickToBottom}
 * adds the one behavior anchoring itself never provides.
 *
 * @param getScrollElement Returns the scroll container. For a window scroller
 *   pass `() => document.scrollingElement`.
 * @param dep A value that changes whenever the content can grow at the edge
 *   (e.g. the newest row's key, the row count, or a measurement tick). The
 *   re-pin runs after each change, so it also re-sticks as dynamic rows settle.
 */
function useStickToEdge(
  getScrollElement: () => HTMLElement | null,
  edge: 'top' | 'bottom',
  dep: unknown,
  {enabled = true, slack = DEFAULT_SLACK}: StickOptions,
): void {
  // Whether the user is currently parked at the followed edge. Updated on every
  // scroll (i.e. *before* the content grows), so at grow-time it reflects the
  // pre-growth position — which is the whole trick.
  const stuckRef = useRef(true);

  // `dep` is deliberately in the deps: when the scroll container renders
  // conditionally, `getScrollElement()` can be null on the first pass and
  // nothing else here would ever re-run — the listener would never attach and
  // `stuckRef` would stay at its initial `true`, yanking the view to the edge
  // on every content change. Re-running per content tick guarantees we attach
  // (and re-measure) once the element exists; the re-subscription is cheap.
  useEffect(() => {
    const el = getScrollElement();
    if (!el || !enabled) return undefined;
    const measure = () => {
      stuckRef.current =
        edge === 'bottom'
          ? el.scrollHeight - el.scrollTop - el.clientHeight <= slack
          : el.scrollTop <= slack;
    };
    measure();
    const target = scrollEventTarget(el);
    target.addEventListener('scroll', measure, {passive: true});
    return () => target.removeEventListener('scroll', measure);
  }, [getScrollElement, edge, slack, enabled, dep]);

  // After the content grows, snap back to the edge if we were parked there.
  // Layout effect (not passive) so it happens before paint — no flash of the
  // un-followed position.
  useLayoutEffect(() => {
    if (!enabled || !stuckRef.current) return;
    const el = getScrollElement();
    if (!el) return;
    el.scrollTop = edge === 'bottom' ? el.scrollHeight : 0;
  }, [dep, getScrollElement, edge, enabled]);
}

/**
 * Stick-to-bottom: after content grows, stay pinned to the bottom if the user
 * was already at the bottom. The building block for a chat / log UI on top of
 * native scroll anchoring. See {@link useStickToEdge}.
 */
export function useStickToBottom(
  getScrollElement: () => HTMLElement | null,
  dep: unknown,
  options: StickOptions = {},
): void {
  useStickToEdge(getScrollElement, 'bottom', dep, options);
}

/**
 * Stick-to-top: after content grows at the top, stay pinned to `scrollTop: 0`
 * if the user was already there (so a new item prepended to a feed is revealed
 * rather than pushed off-screen). Mirror of {@link useStickToBottom}; this is
 * what native anchoring does for you at offset 0, made explicit and mode-
 * independent. See {@link useStickToEdge}.
 */
export function useStickToTop(
  getScrollElement: () => HTMLElement | null,
  dep: unknown,
  options: StickOptions = {},
): void {
  useStickToEdge(getScrollElement, 'top', dep, options);
}
