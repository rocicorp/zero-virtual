import type {ScrollAdapter} from './scroll-adapter.ts';

/**
 * Slack (px) around the bottom edge so sub-pixel rounding or a stray
 * fractional scroll position doesn't count as "not at the bottom".
 */
export const DEFAULT_STICK_SLACK = 4;

export type StickToBottomController = {
  /**
   * Call after content may have grown at the bottom (post-DOM-update,
   * pre-paint). Re-pins to the bottom if the user was parked there; attaches
   * the scroll listener lazily once the element exists.
   */
  contentChanged(): void;
  /** Remove listeners. Safe to call repeatedly. */
  detach(): void;
};

/**
 * The framework-free heart of stick-to-bottom: track "is the user parked at
 * the bottom?" on every scroll (i.e. *before* content grows, which is the
 * whole trick), and snap back to the bottom on content growth only while
 * stuck. Starts unstuck; the first measurement decides (a freshly mounted
 * short list measures as at-bottom, so a chat still starts stuck, while a
 * restored mid-list position is never yanked).
 */
export function createStickToBottom(
  getScrollElement: () => HTMLElement | null,
  adapter: ScrollAdapter,
  slack: number = DEFAULT_STICK_SLACK,
): StickToBottomController {
  let stuck = false;
  let attachedEl: HTMLElement | null = null;
  let unsubscribe: (() => void) | null = null;

  const ensureAttached = (): HTMLElement | null => {
    const el = getScrollElement();
    if (el === attachedEl) return el;
    unsubscribe?.();
    unsubscribe = null;
    attachedEl = el;
    if (!el) return null;
    const scroller = adapter.scrollElement(el);
    const measure = () => {
      stuck =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
        slack;
    };
    measure();
    unsubscribe = adapter.subscribe(el, measure, () => {});
    return el;
  };

  return {
    contentChanged() {
      const el = ensureAttached();
      if (!el || !stuck) return;
      const scroller = adapter.scrollElement(el);
      scroller.scrollTop = scroller.scrollHeight;
    },
    detach() {
      unsubscribe?.();
      unsubscribe = null;
      attachedEl = null;
    },
  };
}
