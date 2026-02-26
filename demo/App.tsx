import {useZeroVirtualizer} from '@rocicorp/zero-virtual/react';
import {useCallback, useMemo, useRef, useState} from 'react';
import styles from './App.module.css';
import {ItemCount} from './ItemCount.tsx';
import {queries, type ItemStart, type ListContextParams} from './queries.ts';
import type {Item} from './schema.ts';
import {SortControls} from './SortControls.tsx';

const ITEM_HEIGHT = 48;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function getRowKey(item: Item): string {
  return item.id;
}

function toStartRow(item: Item): ItemStart {
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

export function App() {
  const [sortField, setSortField] = useState<'created' | 'modified'>(
    'modified',
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const toggleSortField = useCallback(() => {
    setSortField(f => (f === 'modified' ? 'created' : 'modified'));
  }, []);

  const toggleSortDirection = useCallback(() => {
    setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
  }, []);

  const parentRef = useRef<HTMLDivElement>(null);

  const getScrollElement = useCallback(() => parentRef.current, []);

  const listContextParams = useMemo<ListContextParams>(
    () => ({sortField, sortDirection}),
    [sortField, sortDirection],
  );

  const getPageQuery = useCallback(
    (limit: number, start: ItemStart | null, dir: 'forward' | 'backward') => {
      return queries.item.getPageQuery({
        limit,
        start,
        dir,
        listContextParams,
      });
    },
    [listContextParams],
  );

  const {virtualizer, rowAt, estimatedTotal, total} = useZeroVirtualizer({
    listContextParams,
    getScrollElement,
    getRowKey,
    estimateSize,
    getPageQuery,
    getSingleQuery,
    toStartRow,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>
          Zero Virtual Demo
          <ItemCount total={total} estimatedTotal={estimatedTotal} />
        </h1>
        <SortControls
          sortField={sortField}
          sortDirection={sortDirection}
          onToggleSortField={toggleSortField}
          onToggleSortDirection={toggleSortDirection}
        />
      </div>
      {/* Scrollable viewport */}
      <div ref={parentRef} className={styles.viewport}>
        {/* Total height spacer */}
        <div style={{height: virtualizer.getTotalSize(), position: 'relative'}}>
          {virtualItems.map(virtualRow => {
            const row = rowAt(virtualRow.index);

            if (row === undefined) {
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
                <span className={styles.rowLabel}>{row.title}</span>
                <span className={styles.rowValue}>
                  {dateFormatter.format(row[sortField])}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
