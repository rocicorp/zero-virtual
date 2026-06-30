import {
  useHistoryScrollState,
  useStickToBottom,
  useStickToTop,
  useZeroWindowVirtualizer,
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
    transformOn,
    setTransformOn,
    anchoring,
    setAnchoring,
    count,
    follow,
    setFollow,
  } = useDemoControls();

  // The rows are rendered into this element (in normal page flow); the window
  // is the scroll container. The rows wrapper is itself the shift target for
  // the window scroller, so `getShiftElement` defaults to it.
  const rowsRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => rowsRef.current, []);
  // Follow-edge sticks against the document scrolling element (the window is
  // the scroller, not the rows wrapper `getScrollElement` returns).
  const getStickElement = useCallback(
    () => document.scrollingElement as HTMLElement | null,
    [],
  );

  const estimateSize = useEstimateSize(heightMode);
  const getPageQuery = useGetPageQuery(listContextParams);
  const [scrollState, onScrollStateChange] = useHistoryScrollState<ItemStart>();

  const {items, spaceBefore, spaceAfter, estimatedTotal, total, debug} =
    useZeroWindowVirtualizer({
      listContextParams,
      getScrollElement,
      useTransformWhileScrolling: transformOn,
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
  useStickToBottom(getStickElement, contentTick, {
    enabled: follow === 'bottom',
  });
  useStickToTop(getStickElement, contentTick, {enabled: follow === 'top'});

  return (
    <div style={{fontFamily: 'Inter, system-ui, sans-serif'}}>
      {/* Sticky bar: the header carries its own padding and bottom border; the
          wrapper only pins it and paints the background while stuck. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          background: '#fff',
        }}
      >
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
        transformOn={transformOn}
        onToggleTransform={setTransformOn}
        anchoring={anchoring}
        onAnchoringChange={setAnchoring}
        follow={follow}
        onFollowChange={setFollow}
      />
    </div>
  );
}
