import {rowAttributes, type VirtualRow} from '@rocicorp/zero-virtual/react';
import React from 'react';
import styles from '../shared/App.module.css';
import {
  dateFormatter,
  rowPresentation,
  type HeightMode,
} from '../shared/items.ts';
import type {Item} from '../shared/schema.ts';

/**
 * One list row — or its loading placeholder — shared by the element and window
 * scroller demos. `rowAttributes` stamps the attributes the virtualizer
 * measures against (visible-row detection, permalink targets, anchoring
 * reference), so every row variant must carry them. In a grid the row places
 * itself in its column (`lane`); a plain list's block layout ignores that.
 */
export function ItemRow({
  item: {index, key, row, lane},
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
  const style = {height, gridColumn: lane + 1};

  if (row === undefined) {
    return (
      <div {...rowAttributes(index, key)} className={className} style={style}>
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
      style={style}
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
