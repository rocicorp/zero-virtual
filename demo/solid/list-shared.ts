import type {
  AnchoringMode,
  GetPageQueryOptions,
} from '../../src/solid/index.ts';
import {createMemo} from 'solid-js';
import styles from '../shared/App.module.css';
import {estimateFor, getPageQuery, type HeightMode} from '../shared/items.ts';
import type {ItemStart, ListContextParams} from '../shared/queries.ts';
import {layoutFromParams, paramsForLayout} from '../shared/layout.ts';
import {setUrlParams} from '../shared/url-params.ts';
import {createUrlParams, createUrlState} from './use-url-state.ts';

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
  return (options: GetPageQueryOptions<ItemStart>) =>
    getPageQuery(listContextParams(), options);
}

export function createEstimateSize(heightMode: () => HeightMode): () => number {
  return () => estimateFor(heightMode());
}

export function createDemoControls() {
  const [heightModeStr, setHeightMode] = createUrlState('height', 'uniform');
  // Read together: a layout change sets both parameters in one navigation,
  // and taking them one at a time would render the layout in between.
  const layout = createUrlParams(
    params =>
      layoutFromParams(params.get('lanes') ?? '1', params.get('masonry') ?? ''),
    (a, b) => a.lanes === b.lanes && a.masonry === b.masonry,
  );
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
    lanes: () => layout().lanes,
    masonry: () => layout().masonry,
    // Write a layout select value to the URL (see ../shared/layout.ts).
    setLayout: (value: string) => setUrlParams(paramsForLayout(value)),
    anchoring: () => anchoringStr() as AnchoringMode,
    setAnchoring,
    count,
    follow,
    setFollow,
  };
}
