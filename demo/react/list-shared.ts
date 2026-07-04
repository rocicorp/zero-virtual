import {
  type AnchoringMode,
  type GetPageQueryOptions,
  type GetSingleQueryOptions,
  type VirtualRow,
} from '@rocicorp/zero-virtual/react';
import {useCallback, useMemo, useState} from 'react';
import {queries, type ItemStart, type ListContextParams} from '../shared/queries.ts';
import type {Item} from '../shared/schema.ts';
import {useUrlState} from './use-url-state.ts';

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
 * spacers that stand in for not-yet-loaded rows (the scrollbar is approximate,
 * as with any virtualized list). Real heights come from the DOM.
 */
export function useEstimateSize(heightMode: HeightMode): () => number {
  return useCallback(
    () => (heightMode === 'uniform' ? ITEM_HEIGHT : SIZE_ESTIMATE),
    [heightMode],
  );
}

/**
 * The URL-driven demo controls shared by both scroller demos (the DevPanel
 * inputs): row-height mode, transform-while-scrolling, anchoring mode, the
 * optional exact `count` (for an accurate, stable scrollbar — e.g. ?count=5000;
 * without it the estimate grows as rows are discovered and the handle jumps),
 * and follow-bottom (stick-to-bottom for chat).
 */
export function useDemoControls() {
  const [heightModeStr, setHeightMode] = useUrlState('height', 'uniform');
  const heightMode = heightModeStr as HeightMode;
  const [anchoringStr, setAnchoring] = useUrlState('anchoring', 'manual');
  const anchoring = anchoringStr as AnchoringMode;
  const [countStr] = useUrlState('count', '');
  // Guard against non-numeric ?count= — NaN would flow into the spacer math
  // (NaN heights) with no error.
  const parsedCount = Number(countStr);
  const count =
    countStr && Number.isFinite(parsedCount) ? parsedCount : undefined;
  const [follow, setFollow] = useUrlState('follow', 'off');
  return {
    heightMode,
    setHeightMode,
    anchoring,
    setAnchoring,
    count,
    follow,
    setFollow,
  };
}

/**
 * A signal that changes whenever the loaded window / spacers grow, so the
 * follow-edge hooks re-pin after the content settles.
 */
export function contentTickOf(
  items: ReadonlyArray<VirtualRow<Item>>,
  spaceBefore: number,
  spaceAfter: number,
): string {
  return `${items.length}:${items[0]?.key ?? ''}:${
    items[items.length - 1]?.key ?? ''
  }:${spaceBefore}:${spaceAfter}`;
}
