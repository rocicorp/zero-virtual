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
  contentWrapperProps,
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
    setLanes,
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

      {/* The rows element is the content wrapper. `spaceBefore` / `spaceAfter`
          stand in for the unloaded rows above and below, rendered as spacer
          elements (spanning every column when `lanes` makes the wrapper a
          grid) so scroll anchoring keeps the viewport stable across
          paging. */}
      <div ref={rowsRef} {...contentWrapperProps(lanes)}>
        <div style={{height: spaceBefore, gridColumn: '1 / -1'}} />
        {items.map(item => (
          <ItemRow
            key={item.key}
            item={item}
            heightMode={heightMode}
            sortField={sortField}
            permalinkID={permalinkID}
          />
        ))}
        <div style={{height: spaceAfter, gridColumn: '1 / -1'}} />
      </div>
      <DevPanel
        getScrollElement={getScrollElement}
        windowMode
        heightMode={heightMode}
        onHeightModeChange={setHeightMode}
        lanes={lanes}
        onLanesChange={setLanes}
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
