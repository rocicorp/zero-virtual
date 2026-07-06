import type {ObserveElementOffset, ResolvedScrollOptions} from './scroll.ts';

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
 *
 * @param getScrollElement Returns the resolved scrolling element (the
 *   virtualizer's `scrollElement`); may be null until mounted.
 * @param observeElementOffset The same scroll-offset observer the virtualizer
 *   uses (stuckness is tracked on every scroll).
 */
export function createStickToBottom(
  getScrollElement: () => HTMLElement | null,
  observeElementOffset: ObserveElementOffset,
  slack: number = DEFAULT_STICK_SLACK,
): StickToBottomController {
  let stuck = false;
  let attachedEl: HTMLElement | null = null;
  let unsubscribe: (() => void) | null = null;

  const ensureAttached = (): HTMLElement | null => {
    const scroller = getScrollElement();
    if (scroller === attachedEl) return scroller;
    unsubscribe?.();
    unsubscribe = null;
    attachedEl = scroller;
    if (!scroller) return null;
    const measure = () => {
      stuck =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
        slack;
    };
    measure();
    unsubscribe =
      observeElementOffset({scrollElement: scroller}, measure) ?? null;
    return scroller;
  };

  return {
    contentChanged() {
      const scroller = ensureAttached();
      if (!scroller || !stuck) return;
      scroller.scrollTop = scroller.scrollHeight;
    },
    detach() {
      unsubscribe?.();
      unsubscribe = null;
      attachedEl = null;
    },
  };
}

/**
 * The values that change whenever content can grow at the bottom: the loaded
 * window and the spacers. The React binding spreads them into its effect
 * deps; the Solid binding calls this inside its effect so reading the store
 * fields tracks them.
 */
export function contentGrowthDeps(snapshot: {
  readonly items: ReadonlyArray<{readonly key: unknown}>;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
}): unknown[] {
  const {items, spaceBefore, spaceAfter} = snapshot;
  return [
    items.length,
    items[0]?.key ?? '',
    items[items.length - 1]?.key ?? '',
    spaceBefore,
    spaceAfter,
  ];
}

export type StickToBottomCache = {
  /**
   * Call per content tick while enabled. Recreates the controller when the
   * resolved scroll wiring or `slack` changes (they're baked into the core
   * controller), then re-pins via {@linkcode StickToBottomController.contentChanged}.
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
        options.observeElementOffset,
        slack,
      );
      key = [options, slack];
      controller.contentChanged();
    },
    detach() {
      controller?.detach();
      controller = null;
      key = null;
    },
  };
}
