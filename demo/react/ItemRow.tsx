import {rowAttributes, type VirtualRow} from '@rocicorp/zero-virtual/react';
import React from 'react';
import styles from '../shared/App.module.css';
import {ITEM_HEIGHT, SIZE_ESTIMATE, type HeightMode} from './list-shared.ts';
import type {Item} from '../shared/schema.ts';

// Design-handoff date format, e.g. "Nov 7, 2023, 8:13 AM".
const dateFormatter = new Intl.DateTimeFormat('en-US', {
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

// Per height mode: the row's class variant and (when not dynamic) its height.
// Uniform is a compact single-line row; fixed keeps its per-id precomputed
// heights; dynamic renders at natural content height.
function rowPresentation(
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

/**
 * A spacer standing in for the estimated unloaded rows above/below the loaded
 * window. The `.spacer` class carries `overflow-anchor: none` so native scroll
 * anchoring never anchors to a resizing spacer, only to a real row.
 */
export function Spacer({height}: {height: number}): React.ReactNode {
  return <div className={styles.spacer} style={{height}} />;
}

/**
 * One list row — or its loading placeholder — shared by the element and window
 * scroller demos. `rowAttributes` stamps the attributes the virtualizer
 * measures against (visible-row detection, permalink targets, anchoring
 * reference), so every row variant must carry them.
 */
export function ItemRow({
  item: {index, key, row},
  heightMode,
  sortField,
  permalinkID,
}: {
  item: VirtualRow<Item>;
  heightMode: HeightMode;
  sortField: 'created' | 'modified';
  permalinkID: string | null;
}): React.ReactNode {
  const {className, height} = rowPresentation(heightMode, row);

  if (row === undefined) {
    return (
      <div
        {...rowAttributes(index, key)}
        className={className}
        style={{height}}
      >
        <div className={styles.rowText}>
          <div className={styles.rowTitle}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <a
      {...rowAttributes(index, key)}
      className={className}
      style={{height}}
      aria-selected={row.id === permalinkID || undefined}
      href={`#${row.id}`}
    >
      <div className={styles.rowText}>
        <div className={styles.rowTitle}>{row.title}</div>
        {heightMode !== 'uniform' && (
          <div className={styles.rowDesc}>{row.description}</div>
        )}
      </div>
      <div className={styles.rowDate}>
        {dateFormatter.format(row[sortField])}
      </div>
    </a>
  );
}
