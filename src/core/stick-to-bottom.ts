import {contentWrapper} from './dom.ts';
import type {ResolvedScrollOptions} from './scroll.ts';

/**
 * Slack (px) around the bottom edge so sub-pixel rounding or a stray
 * fractional scroll position doesn't count as "not at the bottom".
 */
export const DEFAULT_STICK_SLACK = 4;

/** Options of the framework stick-to-bottom bindings. */
export type StickOptions = {
  /**
   * Turn the behavior on/off — in React without violating the rules of hooks
   * (call the hook unconditionally, flip this instead). Defaults to `true`.
   */
  enabled?: boolean | undefined;
  /** Px of slack around the edge (defaults to {@link DEFAULT_STICK_SLACK}). */
  slack?: number | undefined;
};

export type StickToBottomController = {
  /**
   * Idempotent (re)wiring: resolves the elements and attaches the observers
   * once both exist, re-attaching if either was replaced. Call whenever the
   * elements may have (dis)appeared — e.g. per framework commit. The actual
   * re-pinning is driven by the observers, not by this call.
   */
  ensure(): void;
  /** Remove listeners and observers. Safe to call repeatedly. */
  detach(): void;
};

/**
 * The framework-free heart of stick-to-bottom, driven purely by the DOM:
 * track "is the user parked at the bottom?" on every scroll (i.e. *before*
 * content grows, which is the whole trick), and snap back to the bottom on
 * growth only while stuck. Growth is detected with two ResizeObservers — one
 * on the rows' content wrapper (anything that changes the scrollable extent:
 * rows added, the space-estimate spacer elements resized, a row streaming in
 * taller) and one on the scroll container (viewport resizes; the window
 * `resize` event when the document itself scrolls). Both fire post-layout,
 * pre-paint, so the re-pin never flickers. No content change notifications
 * are needed from the framework or the virtualizer.
 *
 * Starts unstuck; the first measurement decides (a freshly mounted short list
 * measures as at-bottom, so a chat still starts stuck, while a restored
 * mid-list position is never yanked).
 *
 * @param getScrollElement Returns the resolved scrolling element (the
 *   virtualizer's `scrollElement`); may be null until mounted.
 * @param getContentElement Returns the rows' content wrapper — the element
 *   whose border-box grows with the content (the bindings derive it as the
 *   parent of the first rendered row); may be null until rows render.
 */
export function createStickToBottom(
  getScrollElement: () => HTMLElement | null,
  getContentElement: () => HTMLElement | null,
  slack: number = DEFAULT_STICK_SLACK,
): StickToBottomController {
  let stuck = false;
  let attached: {
    readonly scroller: HTMLElement;
    readonly content: HTMLElement;
  } | null = null;
  let cleanup: (() => void) | null = null;

  const detach = () => {
    cleanup?.();
    cleanup = null;
    attached = null;
  };

  return {
    ensure() {
      const scroller = getScrollElement();
      const content = scroller && getContentElement();
      if (
        attached &&
        attached.scroller === scroller &&
        attached.content === content
      ) {
        return;
      }
      detach();
      if (!scroller || !content) return;
      attached = {scroller, content};

      const measure = () => {
        stuck =
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
          slack;
      };
      // Re-pin using the stuckness measured before the growth. Snap to the
      // exact bottom rather than preserving the (sub-slack) gap: the slack is
      // rounding tolerance, not an intentional offset, and snapping is what
      // guarantees the newest content is on screen. Writing past the maximum
      // and letting the browser clamp lands on the exact (possibly
      // fractional) end; the resulting scroll event re-measures at the
      // bottom, so stuck stays latched.
      const repin = () => {
        if (stuck) scroller.scrollTop = scroller.scrollHeight;
      };
      measure();

      // Scroll events fire on the window when the document itself scrolls.
      const scrollTarget: HTMLElement | Window =
        scroller === document.scrollingElement ? window : scroller;
      scrollTarget.addEventListener('scroll', measure, {passive: true});
      const observer = new ResizeObserver(repin);
      observer.observe(content, {box: 'border-box'});
      let removeWindowResize: (() => void) | null = null;
      if (scroller === document.scrollingElement) {
        // A ResizeObserver on the scrolling element tracks the document (its
        // content), not the viewport — use the window resize event instead.
        window.addEventListener('resize', repin);
        removeWindowResize = () => window.removeEventListener('resize', repin);
      } else {
        observer.observe(scroller, {box: 'border-box'});
      }
      cleanup = () => {
        scrollTarget.removeEventListener('scroll', measure);
        observer.disconnect();
        removeWindowResize?.();
      };
    },
    detach,
  };
}

export type StickToBottomCache = {
  /**
   * Call per framework tick while enabled. Recreates the controller when the
   * resolved scroll wiring or `slack` changes (they're baked into the core
   * controller), then lets it lazily (re)attach via
   * {@linkcode StickToBottomController.ensure}.
   */
  ensure(
    virtualizer: {
      readonly options: ResolvedScrollOptions;
      readonly scrollElement: HTMLElement | null;
    },
    slack: number,
  ): void;
  /** Remove listeners and forget the controller. Safe to call repeatedly. */
  detach(): void;
};

/**
 * The shared per-binding state machine of the framework stick-to-bottom
 * helpers: a cached {@linkcode createStickToBottom} controller keyed on the
 * virtualizer's resolved scroll wiring (identity-stable while its members
 * are) and the slack.
 */
export function createStickToBottomCache(): StickToBottomCache {
  let controller: StickToBottomController | null = null;
  let key: readonly [ResolvedScrollOptions, number] | null = null;
  return {
    ensure(virtualizer, slack) {
      const {options} = virtualizer;
      if (controller && key && (key[0] !== options || key[1] !== slack)) {
        controller.detach();
        controller = null;
      }
      // `scrollElement` is a live getter delegating to the resolved wiring,
      // so reading it through this virtualizer result stays current for the
      // controller's whole lifetime.
      controller ??= createStickToBottom(
        () => virtualizer.scrollElement,
        () => {
          const scroller = virtualizer.scrollElement;
          return scroller && contentWrapper(scroller);
        },
        slack,
      );
      key = [options, slack];
      controller.ensure();
    },
    detach() {
      controller?.detach();
      controller = null;
      key = null;
    },
  };
}
