import {
  type AnchoringMode,
  type GetPageQueryOptions,
  type GetSingleQueryOptions,
} from '@rocicorp/zero-virtual/react';
import {useCallback, useMemo, useState, type CSSProperties} from 'react';
import styles from '../shared/App.module.css';
import {
  queries,
  type ItemStart,
  type ListContextParams,
} from '../shared/queries.ts';
import type {Item} from '../shared/schema.ts';
import {layoutFromParams, paramsForLayout} from '../shared/layout.ts';
import {setUrlParams, useUrlState} from './use-url-state.ts';

/**
 * How row heights are determined:
 * - `uniform`: every row is the same fixed height (`ITEM_HEIGHT`).
 * - `fixed`:   each row has a different but precomputed height, derived purely
 *              from its (stable) id — no DOM measurement needed.
 * - `dynamic`: heights are unknown ahead of time — each row renders at its
 *              natural content height and the browser lays it out.
 */
export type HeightMode = 'uniform' | 'fixed' | 'dynamic';

/** Row height (px) in `uniform` mode. */
export const ITEM_HEIGHT = 48;

/**
 * Estimate used for not-yet-loaded rows in `fixed` mode and as the initial
 * estimate for every row in `dynamic` mode (real heights come from the DOM).
 */
export const SIZE_ESTIMATE = 80;

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

export function getRowKey(item: Item): string {
  return item.id;
}

export function toStartRow(item: Item): ItemStart {
  return {
    id: item.id,
    created: item.created,
    modified: item.modified,
  };
}

function getQueryOptions(settled: boolean) {
  return {ttl: settled ? '5m' : 'none'} as const;
}

export function getSingleQuery({id, settled}: GetSingleQueryOptions) {
  return {
    query: queries.item.getSingleQuery({id}),
    options: getQueryOptions(settled),
  } as const;
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
    ({limit, start, dir, settled}: GetPageQueryOptions<ItemStart>) => ({
      query: queries.item.getPageQuery({limit, start, dir, listContextParams}),
      options: getQueryOptions(settled),
    }),
    [listContextParams],
  );
}

/**
 * A single representative row-height estimate per mode, used only to size the
 * content-wrapper padding that stands in for not-yet-loaded rows (the
 * scrollbar is approximate, as with any virtualized list). Real heights come
 * from the DOM. In a grid it estimates a grid row (as tall as its tallest
 * cell); the same per-mode figure is close enough for the demo.
 */
export function useEstimateSize(heightMode: HeightMode): () => number {
  return useCallback(
    () => (heightMode === 'uniform' ? ITEM_HEIGHT : SIZE_ESTIMATE),
    [heightMode],
  );
}

// Write a layout select value to the URL (see ../shared/layout.ts).
function setLayout(value: string): void {
  setUrlParams(paramsForLayout(value));
}

/**
 * The URL-driven demo controls shared by both scroller demos (the DevPanel
 * inputs): row-height mode, layout (`lanes` columns, 1 being a plain list, as
 * a grid or with `masonry`), transform-while-scrolling, anchoring mode, the optional exact `count` (for
 * an accurate, stable scrollbar — e.g. ?count=5000; without it the estimate
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
