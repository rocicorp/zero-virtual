/** The size of the scroll viewport. */
export type ScrollRect = {width: number; height: number};

/**
 * How a virtualizer finds and watches its scroll container: an overflow
 * element ({@linkcode elementScroller}) or the window
 * ({@linkcode windowScroller}). The element and window hooks each pass one.
 */
export type Scroller = {
  /**
   * The scrolling element for the element `getScrollElement` returns:
   * itself, or `document.scrollingElement` for the window. Everything
   * positional is read from it — the scroll offset (`scrollTop`), the
   * content's extent (`scrollHeight`), `overflow-anchor`, and touch events
   * (touches bubble to it).
   */
  resolve(el: HTMLElement): HTMLElement;
  /**
   * Reports the viewport's size now and whenever it changes; returns a
   * function that stops it.
   */
  observeRect(
    scrollElement: HTMLElement,
    cb: (rect: ScrollRect) => void,
  ): () => void;
  /** Reports the scroll offset on every scroll; returns a function that stops it. */
  observeOffset(
    scrollElement: HTMLElement,
    cb: (offset: number) => void,
  ): () => void;
};

/** A list that scrolls inside an overflow element. */
export const elementScroller: Scroller = {
  resolve: el => el,
  observeRect(el, cb) {
    const measure = () => cb({width: el.clientWidth, height: el.clientHeight});
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el, {box: 'border-box'});
    return () => observer.disconnect();
  },
  observeOffset(el, cb) {
    const onScroll = () => cb(el.scrollTop);
    el.addEventListener('scroll', onScroll, {passive: true});
    return () => el.removeEventListener('scroll', onScroll);
  },
};

/** A list that scrolls the window. */
export const windowScroller: Scroller = {
  resolve: () => document.scrollingElement as HTMLElement,
  observeRect(_el, cb) {
    const measure = () =>
      cb({width: window.innerWidth, height: window.innerHeight});
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  },
  observeOffset(_el, cb) {
    const onScroll = () => cb(window.scrollY);
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => window.removeEventListener('scroll', onScroll);
  },
};
