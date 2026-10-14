import styles from './App.module.css';
import {queries, type ItemStart, type ListContextParams} from './queries.ts';
import type {Item} from './schema.ts';

// The item list's framework-free parts, shared by the React and Solid demos.

/**
 * How row heights are determined:
 * - `uniform`: every row is the same fixed height (`ITEM_HEIGHT`).
 * - `fixed`:   each row has a different but precomputed height, derived purely
 *              from its (stable) id — no DOM measurement needed.
 * - `dynamic`: heights are unknown ahead of time — each row renders at its
 *              natural content height and the browser lays it out.
 */
export type HeightMode = 'uniform' | 'fixed' | 'dynamic';

/** Row height (px) in `uniform` mode. */
export const ITEM_HEIGHT = 48;

/**
 * Estimate used for not-yet-loaded rows in `fixed` mode and as the initial
 * estimate for every row in `dynamic` mode (real heights come from the DOM).
 */
export const SIZE_ESTIMATE = 80;

/**
 * A single representative row-height estimate per mode, used only to size the
 * space that stands in for not-yet-loaded rows (the scrollbar is approximate,
 * as with any virtualized list). Real heights come from the DOM. In a grid it
 * estimates a grid row (as tall as its tallest cell); the same per-mode figure
 * is close enough for the demo.
 */
export function estimateFor(heightMode: HeightMode): number {
  return heightMode === 'uniform' ? ITEM_HEIGHT : SIZE_ESTIMATE;
}

export function getRowKey(item: Item): string {
  return item.id;
}

export function toStartRow(item: Item): ItemStart {
  return {
    id: item.id,
    created: item.created,
    modified: item.modified,
  };
}

function getQueryOptions(settled: boolean) {
  return {ttl: settled ? '5m' : 'none'} as const;
}

export function getSingleQuery({id, settled}: {id: string; settled: boolean}) {
  return {
    query: queries.item.getSingleQuery({id}),
    options: getQueryOptions(settled),
  } as const;
}

export function getPageQuery(
  listContextParams: ListContextParams,
  {
    limit,
    start,
    dir,
    settled,
  }: {
    limit: number;
    start: ItemStart | null;
    dir: 'forward' | 'backward';
    settled: boolean;
  },
) {
  return {
    query: queries.item.getPageQuery({limit, start, dir, listContextParams}),
    options: getQueryOptions(settled),
  };
}

// Design-handoff date format, e.g. "Nov 7, 2023, 8:13 AM".
export const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

// Precomputed, non-uniform heights. Keyed off the stable id (not the index) so a
// row keeps the same height as the virtual coordinate space is relabeled during
// paging — otherwise the heights would shift under the viewport while scrolling.
const FIXED_HEIGHTS = [44, 60, 76, 92, 120, 140];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function fixedHeightForId(id: string): number {
  return FIXED_HEIGHTS[hashString(id) % FIXED_HEIGHTS.length];
}

/**
 * Per height mode: the row's class variant and (when not dynamic) its height.
 * Uniform is a compact single-line row; fixed keeps its per-id precomputed
 * heights; dynamic renders at natural content height.
 */
export function rowPresentation(
  heightMode: HeightMode,
  row: Item | undefined,
): {className: string; height: number | undefined} {
  switch (heightMode) {
    case 'uniform':
      return {
        className: `${styles.row} ${styles.rowCompact}`,
        height: ITEM_HEIGHT,
      };
    case 'fixed':
      return {
        className: `${styles.row} ${styles.rowFixed}`,
        height: row ? fixedHeightForId(row.id) : SIZE_ESTIMATE,
      };
    case 'dynamic':
      return {
        className: `${styles.row} ${styles.rowDynamic}`,
        height: undefined,
      };
  }
}
