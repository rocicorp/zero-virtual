import {rowAttributes, type VirtualRow} from '../../src/solid/index.ts';
import {Show} from 'solid-js';
import styles from '../shared/App.module.css';
import {
  dateFormatter,
  rowPresentation,
  type HeightMode,
} from '../shared/items.ts';
import type {Item} from '../shared/schema.ts';

// Reads props via accessors (no destructuring): `item` is a store node the
// binding keeps stable per row key, so the same DOM node survives paging
// while its index/lane/heightMode/permalink props update in place. In a grid
// the row places itself in its column (`lane`); a plain list's block layout
// ignores that.
export function ItemRow(props: {
  item: VirtualRow<Item>;
  heightMode: HeightMode;
  sortField: 'created' | 'modified';
  permalinkID: string | null;
}) {
  const presentation = () => rowPresentation(props.heightMode, props.item.row);
  const style = () => {
    const {height} = presentation();
    const column = `grid-column: ${props.item.lane + 1};`;
    return height === undefined ? column : `height: ${height}px; ${column}`;
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
