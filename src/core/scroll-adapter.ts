/** The size of the scroll viewport. */
export type ScrollRect = {width: number; height: number};

/**
 * Abstracts the scroll container so the same virtualizer works whether the list
 * scrolls inside an element or scrolls the window. Mirrors the split TanStack
 * Virtual makes between its `element*` and `window*` scroll helpers.
 *
 * `el` is always the element the rows are rendered into (returned by
 * `getScrollElement`). For element scrolling it is also the scroll container;
 * for window scrolling the window is the scroll container and `el` is only used
 * to locate the rendered rows.
 */
export type ScrollAdapter = {
  /**
   * The actual scrolling element: the overflow container itself for element
   * scrolling, `document.scrollingElement` for window scrolling. Everything
   * positional is derived from it — scroll offset (`scrollTop`), viewport size
   * (`clientWidth`/`clientHeight`), content extent (`scrollHeight`),
   * `overflow-anchor` toggling, and touch listeners (touches bubble to it).
   */
  scrollElement: (el: HTMLElement) => HTMLElement;
  /**
   * Top of the scroll viewport in client (getBoundingClientRect) coordinates;
   * 0 for the window scroller. Row positions are measured against this. (The
   * nearest TanStack Virtual concept is `scrollMargin`, but that is a static
   * offset from the scroll origin rather than a client coordinate, so the name
   * is not borrowed.)
   */
  viewportTop: (el: HTMLElement) => number;
  /**
   * Listen for `scroll` / `scrollend` on the scroll container (these don't
   * bubble, so where to listen is adapter-specific: the element itself vs. the
   * window). Returns an unsubscribe fn.
   */
  subscribe: (
    el: HTMLElement,
    onScroll: () => void,
    onScrollEnd: () => void,
  ) => () => void;
};

/** Scroll adapter for a list that scrolls inside an overflow element. */
export const elementScrollAdapter: ScrollAdapter = {
  scrollElement: el => el,
  viewportTop: el => el.getBoundingClientRect().top,
  subscribe: (el, onScroll, onScrollEnd) => {
    el.addEventListener('scroll', onScroll, {passive: true});
    el.addEventListener('scrollend', onScrollEnd);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onScrollEnd);
    };
  },
};

/** Scroll adapter for a list that scrolls the window. */
export const windowScrollAdapter: ScrollAdapter = {
  scrollElement: () =>
    (document.scrollingElement as HTMLElement | null) ??
    document.documentElement,
  viewportTop: () => 0,
  subscribe: (_el, onScroll, onScrollEnd) => {
    window.addEventListener('scroll', onScroll, {passive: true});
    window.addEventListener('scrollend', onScrollEnd);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
    };
  },
};
