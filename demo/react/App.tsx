import {
  useHistoryScrollState,
  useStickToBottom,
  useZeroVirtualizer,
} from '@rocicorp/zero-virtual/react';
import React, {useCallback, useRef} from 'react';
import styles from '../shared/App.module.css';
import {DevPanel} from './DevPanel.tsx';
import {ItemDetail} from './ItemDetail.tsx';
import {ItemRow} from './ItemRow.tsx';
import {ListHeader} from './ListHeader.tsx';
import {
  getRowKey,
  getSingleQuery,
  toStartRow,
  useDemoControls,
  useEstimateSize,
  useGetPageQuery,
  useSortState,
} from './list-shared.ts';
import type {ItemStart} from '../shared/queries.ts';
import {useHash} from './use-hash.ts';

export function App(): React.ReactNode {
  const [hash, setHash] = useHash();
  const permalinkID = hash || null;

  const {
    sortField,
    sortDirection,
    toggleSortField,
    toggleSortDirection,
    listContextParams,
  } = useSortState();
  const {
    heightMode,
    setHeightMode,
    anchoring,
    setAnchoring,
    count,
    follow,
    setFollow,
  } = useDemoControls();

  const parentRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => parentRef.current, []);

  const estimateSize = useEstimateSize(heightMode);
  const getPageQuery = useGetPageQuery(listContextParams);
  const [scrollState, onScrollStateChange] = useHistoryScrollState<ItemStart>();

  const virtualizer = useZeroVirtualizer({
    listContextParams,
    getScrollElement,
    anchoring,
    count,
    getRowKey,
    estimateSize,
    getPageQuery,
    getSingleQuery,
    toStartRow,
    permalinkID,
    scrollState,
    onScrollStateChange,
    onSettled: useCallback(() => {
      console.log('onSettled');
    }, []),
  });
  const {items, spaceBefore, spaceAfter, estimatedTotal, total} = virtualizer;

  useStickToBottom(virtualizer, {enabled: follow === 'bottom'});

  return (
    <div className={styles.page}>
      <div className={styles.list}>
        <ListHeader
          total={total}
          estimatedTotal={estimatedTotal}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggleSortField={toggleSortField}
          onToggleSortDirection={toggleSortDirection}
        />
        {/* Scrollable viewport. Rows render in normal flow inside a content
            wrapper. `spaceBefore` / `spaceAfter` stand in for the unloaded rows
            above and below, rendered as spacer elements so scroll anchoring
            keeps the viewport stable across paging. */}
        <div ref={parentRef} className={styles.viewport}>
          <div>
            <div style={{height: spaceBefore}} />
            {items.map(item => (
              <ItemRow
                key={item.key}
                item={item}
                heightMode={heightMode}
                sortField={sortField}
                permalinkID={permalinkID}
              />
            ))}
            <div style={{height: spaceAfter}} />
          </div>
        </div>
      </div>
      {permalinkID && (
        <ItemDetail id={permalinkID} onClose={() => setHash('')} />
      )}
      <DevPanel
        getScrollElement={getScrollElement}
        heightMode={heightMode}
        onHeightModeChange={setHeightMode}
        sortDirection={sortDirection}
        anchoring={anchoring}
        onAnchoringChange={setAnchoring}
        follow={follow}
        onFollowChange={setFollow}
      />
    </div>
  );
}
