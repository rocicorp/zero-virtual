import {
  useHistoryScrollState,
  useStickToBottom,
  useZeroWindowVirtualizer,
  windowScrollAdapter,
} from '@rocicorp/zero-virtual/react';
import React, {useCallback, useRef} from 'react';
import {DevPanel} from './DevPanel.tsx';
import {ItemRow, Spacer} from './ItemRow.tsx';
import {ListHeader} from './ListHeader.tsx';
import {
  contentTickOf,
  getRowKey,
  getSingleQuery,
  toStartRow,
  useDemoControls,
  useEstimateSize,
  useGetPageQuery,
  useSortState,
} from './list-shared.ts';
import type {ItemStart} from './queries.ts';
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

  const {items, spaceBefore, spaceAfter, estimatedTotal, total, debug} =
    useZeroWindowVirtualizer({
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
    });

  const contentTick = contentTickOf(items, spaceBefore, spaceAfter);
  useStickToBottom(getScrollElement, contentTick, {
    enabled: follow === 'bottom',
    adapter: windowScrollAdapter,
  });

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

      <div ref={rowsRef}>
        <Spacer height={spaceBefore} />
        {items.map(item => (
          <ItemRow
            key={item.key}
            item={item}
            heightMode={heightMode}
            sortField={sortField}
            permalinkID={permalinkID}
          />
        ))}
        <Spacer height={spaceAfter} />
      </div>
      <DevPanel
        debug={debug}
        getScrollElement={getScrollElement}
        windowMode
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
