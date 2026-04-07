import {
  useHistoryScrollState,
  useZeroVirtualizer,
  type GetPageQueryOptions,
} from '@rocicorp/zero-virtual/react';
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './App.module.css';
import {ItemCount} from './ItemCount.tsx';
import {ItemDetail} from './ItemDetail.tsx';
import {queries, type ItemStart, type ListContextParams} from './queries.ts';
import type {Item} from './schema.ts';
import {SortControls} from './SortControls.tsx';
import {useHash} from './use-hash.ts';

// const ITEM_HEIGHT = 48;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function getRowKey(item: Item): string {
  return item.id;
}

function toStartRow(item: Item): ItemStart {
  return {
    id: item.id,
    created: item.created,
    modified: item.modified,
  };
}

function getQueryOptions(settled: boolean) {
  return {ttl: settled ? '5m' : 'none'} as const;
}

export function App(): React.ReactNode {
  const [hash, setHash] = useHash();
  const permalinkID = hash || null;

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
    ({limit, start, dir, settled}: GetPageQueryOptions<ItemStart>) => {
      return {
        query: queries.item.getPageQuery({
          limit,
          start,
          dir,
          listContextParams,
        }),
        options: getQueryOptions(settled),
      };
    },
    [listContextParams],
  );

  const [scrollState, onScrollStateChange] = useHistoryScrollState<ItemStart>();

  const {
    virtualRows,
    estimatedTotal,
    total,
    startPlaceholderHeight,
    endPlaceholderHeight,
    startRef,
    endRef,
  } = useZeroVirtualizer<
    HTMLDivElement,
    HTMLElement,
    ListContextParams,
    Item,
    ItemStart
  >({
    listContextParams,
    getScrollElement,
    getRowKey,
    getPageQuery,
    toStartRow,
    scrollState,
    onScrollStateChange,
    onSettled: useCallback(() => {
      console.log('onSettled');
    }, []),
  });

  // const virtualItems = virtualRows.map((row, index) => ({
  //   key: getRowKey(row),
  //   index,
  //   start: index * ITEM_HEIGHT,
  // }));

  return (
    <div className={styles.page}>
      <div className={styles.list}>
        <div className={styles.header}>
          <h1 className={styles.heading}>
            <span className={styles.headingText}>Zero Virtual Demo</span>
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
          <Placeholder
            kind="start"
            height={startPlaceholderHeight}
            ref={startRef}
          />
          {virtualRows.map(row => (
            <a
              key={getRowKey(row)}
              data-key={getRowKey(row)}
              className={styles.row}
              aria-selected={row.id === permalinkID || undefined}
              href={`#${row.id}`}
            >
              <span className={styles.rowLabel}>{row.title}</span>
              <span className={styles.rowValue}>
                {dateFormatter.format(row[sortField])}
              </span>
            </a>
          ))}
          <Placeholder kind="end" height={endPlaceholderHeight} ref={endRef} />
        </div>
      </div>
      {permalinkID && (
        <ItemDetail id={permalinkID} onClose={() => setHash('')} />
      )}
    </div>
  );
}

function Placeholder({
  kind,
  height,
  ref,
}: {
  kind: 'start' | 'end';
  height: number;
  ref?: ((node: Element | null) => void) | undefined;
}): ReactNode {
  const showLabel = height > 0;
  return (
    <div
      ref={ref}
      data-key={`placeholder-${kind}`}
      className={styles.placeholder}
      style={{height: Math.min(height, 100), overflowAnchor: 'none'}}
    >
      {showLabel ? (
        <span className={styles.rowLabel}>
          {kind === 'start' ? 'Loading... start...' : 'Loading... end...'}
        </span>
      ) : null}
    </div>
  );
}
