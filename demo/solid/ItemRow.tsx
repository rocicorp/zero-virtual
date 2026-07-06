import {rowAttributes, type VirtualRow} from '../../src/solid/index.ts';
import {Show} from 'solid-js';
import styles from '../shared/App.module.css';
import {ITEM_HEIGHT, SIZE_ESTIMATE, type HeightMode} from './list-shared.ts';
import type {Item} from '../shared/schema.ts';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

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

// Reads props via accessors (no destructuring): `item` is a store node the
// binding keeps stable per row key, so the same DOM node survives paging
// while its index/heightMode/permalink props update in place.
export function ItemRow(props: {
  item: VirtualRow<Item>;
  heightMode: HeightMode;
  sortField: 'created' | 'modified';
  permalinkID: string | null;
}) {
  const presentation = () => rowPresentation(props.heightMode, props.item.row);
  const style = () => {
    const {height} = presentation();
    return height === undefined ? undefined : `height: ${height}px;`;
  };

  return (
    <Show
      when={props.item.row}
      fallback={
        <div
          {...rowAttributes(props.item.index, props.item.key)}
          class={presentation().className}
          style={style()}
        >
          <div class={styles.rowText}>
            <div class={styles.rowTitle}>Loading...</div>
          </div>
        </div>
      }
    >
      {row => (
        <a
          {...rowAttributes(props.item.index, props.item.key)}
          class={presentation().className}
          style={style()}
          aria-selected={row().id === props.permalinkID || undefined}
          href={`#${row().id}`}
        >
          <div class={styles.rowText}>
            <div class={styles.rowTitle}>{row().title}</div>
            {props.heightMode !== 'uniform' && (
              <div class={styles.rowDesc}>{row().description}</div>
            )}
          </div>
          <div class={styles.rowDate}>
            {dateFormatter.format(row()[props.sortField])}
          </div>
        </a>
      )}
    </Show>
  );
}
