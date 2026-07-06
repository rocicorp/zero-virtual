import type {RowKey} from './types.ts';

// The row-identification contract between the virtualizer and the rendered
// rows: every row element (including loading placeholders) carries these two
// attributes — they are how the virtualizer finds rows in the DOM (visible-row
// detection for paging, the anchoring reference, permalink targets). Consumers
// should spread {@linkcode rowAttributes} onto each row element.
export const VROW_INDEX_ATTR = 'data-vrow-index';
export const VROW_KEY_ATTR = 'data-vrow-key';

/**
 * The attributes every rendered row (and loading placeholder) must carry, as an
 * object to spread onto the row element: `<div {...rowAttributes(index, key)}>`.
 * See {@linkcode VirtualRow} for `index` / `key`.
 */
export function rowAttributes(
  index: number,
  key: RowKey,
): {'data-vrow-index': number; 'data-vrow-key': RowKey} {
  return {[VROW_INDEX_ATTR]: index, [VROW_KEY_ATTR]: key};
}

/** All rendered row elements inside the container, in DOM order. */
export function queryRows(el: HTMLElement): Iterable<HTMLElement> {
  return el.querySelectorAll<HTMLElement>(`[${VROW_INDEX_ATTR}]`);
}

/** The first rendered row element, or null. */
export function firstRow(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>(`[${VROW_INDEX_ATTR}]`);
}

/**
 * The rows' content wrapper: the parent of the first rendered row — the
 * element carrying the `spaceBefore`/`spaceAfter` padding, whose border-box
 * grows and shrinks with the content. Null until rows render.
 */
export function contentWrapper(el: HTMLElement): HTMLElement | null {
  return firstRow(el)?.parentElement ?? null;
}

/** Find a rendered row element by its stable key. */
export function findRow(el: HTMLElement, key: RowKey): HTMLElement | null {
  return el.querySelector<HTMLElement>(
    `[${VROW_KEY_ATTR}="${CSS.escape(String(key))}"]`,
  );
}

/** Whether a client-coordinate rect overlaps the `[top, bottom)` viewport band. */
export function rectInViewport(
  rect: DOMRect,
  top: number,
  bottom: number,
): boolean {
  return rect.bottom > top && rect.top < bottom;
}
