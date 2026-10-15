import {
  masonryLayout,
  useHistoryScrollState,
  useStickToBottom,
  useZeroVirtualizer,
  useZeroWindowVirtualizer,
} from '@rocicorp/zero-virtual/react';
import React, {useCallback, useRef} from 'react';
import styles from '../shared/App.module.css';
import {DevPanel} from './DevPanel.tsx';
import {ItemDetail} from './ItemDetail.tsx';
import {ItemRow} from './ItemRow.tsx';
import {ListHeader} from './ListHeader.tsx';
import {getRowKey, getSingleQuery, toStartRow} from '../shared/items.ts';
import {
  useDemoControls,
  useEstimateSize,
  useGetPageQuery,
  useSortState,
} from './list-shared.ts';
import {layoutValue} from '../shared/layout.ts';
import type {ItemStart} from '../shared/queries.ts';
import {Rows} from './Rows.tsx';
import {useHash} from './use-hash.ts';
import windowStyles from './WindowList.module.css';

/**
 * The demo list. It scrolls inside an overflow element, with the selected
 * item's details beside it — or, with `windowScroll` (`?scroller=window`),
 * scrolls the window: the rows are in normal page flow under a sticky header,
 * using {@link useZeroWindowVirtualizer}.
 */
export function App({windowScroll}: {windowScroll: boolean}): React.ReactNode {
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

  // The scroll element, or for window scrolling, the element the rows are
  // rendered into.
  const ref = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => ref.current, []);

  const estimateSize = useEstimateSize(heightMode);
  const getPageQuery = useGetPageQuery(listContextParams);
  const [scrollState, onScrollStateChange] = useHistoryScrollState<ItemStart>();

  // The demo remounts when `windowScroll` changes (see Demo), so this is the
  // same hook for the component's lifetime.
  const useVirtualizer = windowScroll
    ? useZeroWindowVirtualizer
    : useZeroVirtualizer;
  const virtualizer = useVirtualizer({
    listContextParams,
    getScrollElement,
    anchoring,
    count,
    lanes,
    layout: masonry ? masonryLayout : undefined,
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

  const header = (
    <ListHeader
      total={total}
      estimatedTotal={estimatedTotal}
      sortField={sortField}
      sortDirection={sortDirection}
      onToggleSortField={toggleSortField}
      onToggleSortDirection={toggleSortDirection}
    />
  );
  // Rows render in normal flow inside a content wrapper (see Rows).
  const rows = (
    <Rows
      wrapperRef={windowScroll ? ref : undefined}
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
  );
  const devPanel = (
    <DevPanel
      getScrollElement={getScrollElement}
      windowMode={windowScroll}
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
  );

  return windowScroll ? (
    <div className={windowStyles.page}>
      <div className={windowStyles.stickyBar}>{header}</div>
      {rows}
      {devPanel}
    </div>
  ) : (
    <div className={styles.page}>
      <div className={styles.list}>
        {header}
        <div ref={ref} className={styles.viewport}>
          {rows}
        </div>
      </div>
      {permalinkID && (
        <ItemDetail id={permalinkID} onClose={() => setHash('')} />
      )}
      {devPanel}
    </div>
  );
}
