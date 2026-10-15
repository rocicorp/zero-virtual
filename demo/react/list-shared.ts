import {
  type AnchoringMode,
  type GetPageQueryOptions,
} from '@rocicorp/zero-virtual/react';
import {useCallback, useMemo, useState, type CSSProperties} from 'react';
import styles from '../shared/App.module.css';
import {estimateFor, getPageQuery, type HeightMode} from '../shared/items.ts';
import type {ItemStart, ListContextParams} from '../shared/queries.ts';
import {layoutFromParams, paramsForLayout} from '../shared/layout.ts';
import {setUrlParams} from '../shared/url-params.ts';
import {useUrlState} from './use-url-state.ts';

/**
 * Props for the rows' content wrapper. As a grid (`lanes` > 1) each row places
 * itself in its column (see `ItemRow`) and the spacers span every column.
 */
export function contentWrapperProps(lanes: number): {
  className?: string;
  style?: CSSProperties;
} {
  return lanes > 1
    ? {
        className: styles.grid,
        style: {gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`},
      }
    : {};
}

/** Sort field/direction state and the derived `listContextParams`. */
export function useSortState() {
  const [sortField, setSortField] = useState<'created' | 'modified'>(
    'modified',
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const toggleSortField = useCallback(
    () => setSortField(f => (f === 'modified' ? 'created' : 'modified')),
    [],
  );
  const toggleSortDirection = useCallback(
    () => setSortDirection(d => (d === 'asc' ? 'desc' : 'asc')),
    [],
  );
  const listContextParams = useMemo<ListContextParams>(
    () => ({sortField, sortDirection}),
    [sortField, sortDirection],
  );
  return {
    sortField,
    sortDirection,
    toggleSortField,
    toggleSortDirection,
    listContextParams,
  };
}

export function useGetPageQuery(listContextParams: ListContextParams) {
  return useCallback(
    (options: GetPageQueryOptions<ItemStart>) =>
      getPageQuery(listContextParams, options),
    [listContextParams],
  );
}

/** The row estimate for a height mode (see `estimateFor`). */
export function useEstimateSize(heightMode: HeightMode): () => number {
  return useCallback(() => estimateFor(heightMode), [heightMode]);
}

// Write a layout select value to the URL (see ../shared/layout.ts).
function setLayout(value: string): void {
  setUrlParams(paramsForLayout(value));
}

/**
 * The URL-driven demo controls shared by both scroller demos (the DevPanel
 * inputs): row-height mode, layout (`lanes` columns, 1 being a plain list, as
 * a grid or masonry), anchoring mode, the optional exact `count` (for an
 * accurate, stable scrollbar — e.g. ?count=5000; without it the estimate
 * grows as rows are discovered and the handle jumps), and follow-bottom
 * (stick-to-bottom for chat).
 */
export function useDemoControls() {
  const [heightModeStr, setHeightMode] = useUrlState('height', 'uniform');
  const heightMode = heightModeStr as HeightMode;
  const [lanesStr] = useUrlState('lanes', '1');
  const [masonryStr] = useUrlState('masonry', '');
  const {lanes, masonry} = layoutFromParams(lanesStr, masonryStr);
  const [anchoringStr, setAnchoring] = useUrlState('anchoring', 'manual');
  const anchoring = anchoringStr as AnchoringMode;
  const [countStr] = useUrlState('count', '');
  // Guard against non-numeric ?count= — NaN would flow into the space
  // estimates (NaN padding) with no error.
  const parsedCount = Number(countStr);
  const count =
    countStr && Number.isFinite(parsedCount) ? parsedCount : undefined;
  const [follow, setFollow] = useUrlState('follow', 'off');
  return {
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
  };
}
