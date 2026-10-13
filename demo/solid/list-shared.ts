import type {
  AnchoringMode,
  GetPageQueryOptions,
  GetSingleQueryOptions,
} from '../../src/solid/index.ts';
import {createMemo} from 'solid-js';
import styles from '../shared/App.module.css';
import {
  queries,
  type ItemStart,
  type ListContextParams,
} from '../shared/queries.ts';
import type {Item} from '../shared/schema.ts';
import {createUrlState} from './use-url-state.ts';

export type HeightMode = 'uniform' | 'fixed' | 'dynamic';

export const ITEM_HEIGHT = 48;
export const SIZE_ESTIMATE = 80;

/**
 * Props for the rows' content wrapper. As a grid (`lanes` > 1) each row places
 * itself in its column (see `ItemRow`) and the spacers span every column.
 */
export function contentWrapperProps(lanes: number): {
  class?: string;
  style?: string;
} {
  return lanes > 1
    ? {
        class: styles.grid,
        style: `grid-template-columns: repeat(${lanes}, minmax(0, 1fr));`,
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

export function createSortState() {
  const [sortField, setSortField] = createUrlState('sortField', 'modified');
  const [sortDirection, setSortDirection] = createUrlState(
    'sortDirection',
    'desc',
  );

  const toggleSortField = () =>
    setSortField(sortField() === 'modified' ? 'created' : 'modified');
  const toggleSortDirection = () =>
    setSortDirection(sortDirection() === 'asc' ? 'desc' : 'asc');

  const listContextParams = createMemo<ListContextParams>(() => ({
    sortField: sortField() as 'created' | 'modified',
    sortDirection: sortDirection() as 'asc' | 'desc',
  }));

  return {
    sortField,
    sortDirection,
    toggleSortField,
    toggleSortDirection,
    listContextParams,
  };
}

export function createGetPageQuery(listContextParams: () => ListContextParams) {
  return ({limit, start, dir, settled}: GetPageQueryOptions<ItemStart>) => ({
    query: queries.item.getPageQuery({
      limit,
      start,
      dir,
      listContextParams: listContextParams(),
    }),
    options: getQueryOptions(settled),
  });
}

export function createEstimateSize(heightMode: () => HeightMode): () => number {
  return () => (heightMode() === 'uniform' ? ITEM_HEIGHT : SIZE_ESTIMATE);
}

/**
 * The `?lanes=` column count: a whole number of at least 1. Anything else —
 * `Infinity`, a negative, text — falls back to a plain list.
 */
function parseLanes(value: string): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function createDemoControls() {
  const [heightModeStr, setHeightMode] = createUrlState('height', 'uniform');
  const [lanesStr, setLanes] = createUrlState('lanes', '1');
  const [anchoringStr, setAnchoring] = createUrlState('anchoring', 'manual');
  const [countStr] = createUrlState('count', '');
  const [follow, setFollow] = createUrlState('follow', 'off');

  const count = createMemo<number | undefined>(() => {
    const raw = countStr();
    const parsed = Number(raw);
    return raw && Number.isFinite(parsed) ? parsed : undefined;
  });

  return {
    heightMode: () => heightModeStr() as HeightMode,
    setHeightMode,
    lanes: () => parseLanes(lanesStr()),
    setLanes,
    anchoring: () => anchoringStr() as AnchoringMode,
    setAnchoring,
    count,
    follow,
    setFollow,
  };
}
