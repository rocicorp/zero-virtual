/**
 * Whether the browser natively supports `overflow-anchor: auto`.
 *
 * Safari added support in version 18.2 (November 2024).
 * Chrome has supported it since 56 (2017), Firefox since 66 (2019).
 *
 * When `true`, the browser automatically adjusts the scroll position when
 * content is inserted above the visible area, preserving the user's scroll
 * position without any JavaScript intervention — and without interrupting
 * momentum (inertia) scrolling.
 *
 * When `false` (old Safari), a JavaScript polyfill is required: the scroll
 * offset must be corrected manually in a layout effect before paint.
 */
export const supportsOverflowAnchor: boolean =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('overflow-anchor', 'auto');
