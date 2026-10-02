import {useLayoutEffect, useRef} from 'react';

/**
 * Measure the overlays; CSS scroll-padding handles the scrolling offsets.
 * Their heights can change when controls wrap or an error appears. Since the
 * window scrolls, the variables live on html (see Chat.module.css), not a row.
 * Never use these variables to size the measured bars: let their content size
 * them naturally. The footer variable also reserves space at the list's end.
 */
export function useWindowInsets() {
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty(
        '--chat-header-height',
        `${headerRef.current?.offsetHeight ?? 0}px`,
      );
      root.style.setProperty(
        '--chat-footer-height',
        `${footerRef.current?.offsetHeight ?? 0}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    if (headerRef.current)
      observer.observe(headerRef.current, {box: 'border-box'});
    if (footerRef.current)
      observer.observe(footerRef.current, {box: 'border-box'});
    measure();
    return () => {
      observer.disconnect();
      root.style.removeProperty('--chat-header-height');
      root.style.removeProperty('--chat-footer-height');
    };
  }, []);

  return {headerRef, footerRef};
}
