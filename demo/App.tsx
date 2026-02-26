import {useZeroVirtualizer} from '@rocicorp/zero-virtual/react';
import {useQuery} from '@rocicorp/zero/react';
import {useCallback, useMemo, useRef} from 'react';
import styles from './App.module.css';
import {queries, type ItemStart} from './queries.ts';
import type {Item} from './schema.ts';

const ITEM_HEIGHT = 48;

function getRowKey(item: Item): string {
  return item.id;
}

function getStartRow(item: Item): ItemStart {
  return {
    created: item.created,
    modified: item.modified,
  };
}

function estimateSize(): number {
  return ITEM_HEIGHT;
}

function getSingleQuery(id: string) {
  return queries.item.getSingleQuery({id});
}

type ListContextParams = {
  sortField: 'created' | 'modified';
};

export function App() {
  const [items] = useQuery(queries.item.all());

  const parentRef = useRef<HTMLDivElement>(null);

  const getScrollElement = useCallback(() => parentRef.current, []);

  const listContextParams = useMemo(
    () =>
      ({
        sortField: 'modified',
      }) as const,
    [],
  );

  const getPageQuery = useCallback(
    (limit: number, start: ItemStart | null, dir: 'forward' | 'backward') => {
      return queries.item.getPageQuery({
        limit,
        start,
        dir,
        sortField: listContextParams.sortField,
      });
    },
    [listContextParams],
  );

  const {virtualizer} = useZeroVirtualizer<
    Element,
    Element,
    ListContextParams,
    Item,
    ItemStart
  >({
    listContextParams,
    getScrollElement,
    getRowKey,
    estimateSize,
    getPageQuery,
    getSingleQuery,
    toStartRow: getStartRow,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>TanStack Virtual Demo</h1>
      {/* Scrollable viewport */}
      <div ref={parentRef} className={styles.viewport}>
        {/* Total height spacer */}
        <div style={{height: virtualizer.getTotalSize(), position: 'relative'}}>
          {virtualItems.map(virtualRow => {
            const item = items[virtualRow.index];
            if (item === undefined) {
              // placeholder
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  className={styles.row}
                  style={{transform: `translateY(${virtualRow.start}px)`}}
                >
                  <span className={styles.rowLabel}>Loading...</span>
                </div>
              );
            }

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                className={styles.row}
                style={{transform: `translateY(${virtualRow.start}px)`}}
              >
                <span className={styles.rowLabel}>{item.title}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
