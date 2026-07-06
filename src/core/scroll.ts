/** The size of the scroll viewport. */
export type ScrollRect = {width: number; height: number};

/**
 * What the `observe*` functions receive: the slice of the virtualizer they
 * read. `scrollElement` is the resolved scrolling element.
 */
export type ScrollObserverInstance = {
  readonly scrollElement: HTMLElement | null;
};

/**
 * Observes the size of the scroll viewport; returns an unsubscribe function.
 * Same contract as TanStack Virtual's `observeElementRect` /
 * `observeWindowRect`.
 */
export type ObserveElementRect = (
  instance: ScrollObserverInstance,
  cb: (rect: ScrollRect) => void,
) => void | (() => void);

/**
 * Observes the scroll offset; returns an unsubscribe function. Same contract
 * as TanStack Virtual's `observeElementOffset` / `observeWindowOffset`.
 */
export type ObserveElementOffset = (
  instance: ScrollObserverInstance,
  cb: (offset: number) => void,
) => void | (() => void);

/**
 * Resolves the element `getScrollElement` returns to the actual scrolling
 * element (`instance.scrollElement`): identity for element scrolling,
 * `document.scrollingElement` for window scrolling. Everything positional is
 * derived from it — scroll offset (`scrollTop`), viewport size, content
 * extent (`scrollHeight`), `overflow-anchor` toggling, and touch listeners
 * (touches bubble to it). Fixed per entry-point variant (element vs window),
 * not a user option.
 */
export type ResolveScrollElement = (el: HTMLElement) => HTMLElement;

export const resolveElementScrollElement: ResolveScrollElement = el => el;
export const resolveWindowScrollElement: ResolveScrollElement = () =>
  document.scrollingElement as HTMLElement;

/**
 * The scroll wiring the framework bindings accept, TanStack Virtual style:
 * the scroll-element getter plus optional overrides of the observers, which
 * default per entry-point variant — {@linkcode observeElementRect} /
 * {@linkcode observeElementOffset} for element scrolling,
 * {@linkcode observeWindowRect} / {@linkcode observeWindowOffset} for window
 * scrolling.
 */
export type VirtualizerScrollOptions = {
  /**
   * Returns the element the rows are rendered into. For element scrolling it
   * is also the scroll container; for the window variants the window is the
   * scroll container.
   */
  getScrollElement: () => HTMLElement | null;
  observeElementRect?: ObserveElementRect | undefined;
  observeElementOffset?: ObserveElementOffset | undefined;
};

/**
 * The resolved scroll wiring a virtualizer result echoes back as `options`
 * (TanStack style): the scroll-element getter plus the observers after the
 * per-variant defaults are applied. Helpers layered on the virtualizer (e.g.
 * stick-to-bottom) consume this instead of being handed the wiring again.
 */
export type ResolvedScrollOptions = {
  readonly getScrollElement: () => HTMLElement | null;
  readonly observeElementRect: ObserveElementRect;
  readonly observeElementOffset: ObserveElementOffset;
};

/** Viewport-size observer for a list that scrolls inside an overflow element. */
export const observeElementRect: ObserveElementRect = (instance, cb) => {
  const el = instance.scrollElement;
  if (!el) return;
  const measure = () => cb({width: el.clientWidth, height: el.clientHeight});
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(el, {box: 'border-box'});
  return () => observer.disconnect();
};

/** Scroll-offset observer for a list that scrolls inside an overflow element. */
export const observeElementOffset: ObserveElementOffset = (instance, cb) => {
  const el = instance.scrollElement;
  if (!el) return;
  const onScroll = () => cb(el.scrollTop);
  el.addEventListener('scroll', onScroll, {passive: true});
  return () => {
    el.removeEventListener('scroll', onScroll);
  };
};

/** Viewport-size observer for a list that scrolls the window. */
export const observeWindowRect: ObserveElementRect = (_instance, cb) => {
  const measure = () =>
    cb({width: window.innerWidth, height: window.innerHeight});
  measure();
  window.addEventListener('resize', measure);
  return () => window.removeEventListener('resize', measure);
};

/** Scroll-offset observer for a list that scrolls the window. */
export const observeWindowOffset: ObserveElementOffset = (_instance, cb) => {
  const onScroll = () => cb(window.scrollY);
  window.addEventListener('scroll', onScroll, {passive: true});
  return () => {
    window.removeEventListener('scroll', onScroll);
  };
};
