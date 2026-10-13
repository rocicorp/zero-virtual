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
import {layoutValue} from '../shared/layout.ts';
import type {ItemStart} from '../shared/queries.ts';
import {Rows} from './Rows.tsx';
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
    lanes,
    masonry,
    setLayout,
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
    lanes,
    masonry,
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
  const {items, spaceBefore, spaceAfter, estimatedTotal, total, scrollToItem} =
    virtualizer;

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
            wrapper (see Rows). */}
        <div ref={parentRef} className={styles.viewport}>
          <Rows
            lanes={lanes}
            masonry={masonry}
            items={items}
            spaceBefore={spaceBefore}
            spaceAfter={spaceAfter}
            renderRow={item => (
              <ItemRow
                key={item.key}
                item={item}
                heightMode={heightMode}
                sortField={sortField}
                permalinkID={permalinkID}
              />
            )}
          />
        </div>
      </div>
      {permalinkID && (
        <ItemDetail id={permalinkID} onClose={() => setHash('')} />
      )}
      <DevPanel
        getScrollElement={getScrollElement}
        heightMode={heightMode}
        onHeightModeChange={setHeightMode}
        layout={layoutValue({lanes, masonry})}
        onLayoutChange={setLayout}
        sortDirection={sortDirection}
        anchoring={anchoring}
        onAnchoringChange={setAnchoring}
        follow={follow}
        onFollowChange={setFollow}
        scrollToItem={scrollToItem}
      />
    </div>
  );
}
