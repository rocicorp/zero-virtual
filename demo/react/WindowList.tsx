import {
  useHistoryScrollState,
  useStickToBottom,
  useZeroWindowVirtualizer,
} from '@rocicorp/zero-virtual/react';
import React, {useCallback, useRef} from 'react';
import {DevPanel} from './DevPanel.tsx';
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
import styles from './WindowList.module.css';

/**
 * A minimal list that scrolls the *window* (rather than an overflow element),
 * using {@link useZeroWindowVirtualizer}. Rows are in normal page flow; the
 * page scrolls. Reached via `?scroller=window`.
 */
export function WindowList(): React.ReactNode {
  const [hash] = useHash();
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

  // The rows are rendered into this element (in normal page flow); the window
  // is the scroll container.
  const rowsRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => rowsRef.current, []);

  const estimateSize = useEstimateSize(heightMode);
  const getPageQuery = useGetPageQuery(listContextParams);
  const [scrollState, onScrollStateChange] = useHistoryScrollState<ItemStart>();

  const virtualizer = useZeroWindowVirtualizer({
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
  });
  const {items, spaceBefore, spaceAfter, estimatedTotal, total, scrollToItem} =
    virtualizer;

  useStickToBottom(virtualizer, {enabled: follow === 'bottom'});

  return (
    <div className={styles.page}>
      <div className={styles.stickyBar}>
        <ListHeader
          total={total}
          estimatedTotal={estimatedTotal}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggleSortField={toggleSortField}
          onToggleSortDirection={toggleSortDirection}
        />
      </div>

      {/* The rows element is the content wrapper (see Rows). */}
      <Rows
        wrapperRef={rowsRef}
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
      <DevPanel
        getScrollElement={getScrollElement}
        windowMode
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
