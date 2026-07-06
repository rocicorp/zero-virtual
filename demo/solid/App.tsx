import {
  createHistoryScrollState,
  createStickToBottom,
  createZeroVirtualizer,
} from '../../src/solid/index.ts';
import {For, Show, createMemo} from 'solid-js';
import styles from '../shared/App.module.css';
import {DevPanel} from './DevPanel.tsx';
import {ItemDetail} from './ItemDetail.tsx';
import {ItemRow} from './ItemRow.tsx';
import {ListHeader} from './ListHeader.tsx';
import {
  createDemoControls,
  createEstimateSize,
  createGetPageQuery,
  createSortState,
  getRowKey,
  getSingleQuery,
  toStartRow,
} from './list-shared.ts';
import type {ItemStart} from '../shared/queries.ts';
import {createHash} from './hash.ts';

export function App() {
  const [hash, setHash] = createHash();
  const permalinkID = createMemo(() => hash() || null);

  const {
    sortField,
    sortDirection,
    toggleSortField,
    toggleSortDirection,
    listContextParams,
  } = createSortState();

  const {
    heightMode,
    setHeightMode,
    anchoring,
    setAnchoring,
    count,
    follow,
    setFollow,
  } = createDemoControls();

  let parentRef: HTMLDivElement | undefined;
  const getScrollElement = () => parentRef ?? null;

  const estimateSize = createEstimateSize(heightMode);
  const getPageQuery = createGetPageQuery(listContextParams);
  const [scrollState, onScrollStateChange] =
    createHistoryScrollState<ItemStart>();

  const virtualizer = createZeroVirtualizer(() => ({
    listContextParams: listContextParams(),
    getScrollElement,
    anchoring: anchoring(),
    count: count(),
    getRowKey,
    estimateSize,
    getPageQuery,
    getSingleQuery,
    toStartRow,
    permalinkID: permalinkID(),
    scrollState: scrollState(),
    onScrollStateChange,
    onSettled: () => {
      console.log('onSettled');
    },
  }));

  createStickToBottom(virtualizer, () => ({
    enabled: follow() === 'bottom',
  }));

  return (
    <div class={styles.page}>
      <div class={styles.list}>
        <ListHeader
          total={virtualizer().total}
          estimatedTotal={virtualizer().estimatedTotal}
          sortField={sortField() as 'created' | 'modified'}
          sortDirection={sortDirection() as 'asc' | 'desc'}
          onToggleSortField={toggleSortField}
          onToggleSortDirection={toggleSortDirection}
        />
        <div ref={parentRef} class={styles.viewport}>
          {/* Content wrapper: its padding stands in for the unloaded rows
              above and below (padding, not margin, so it always contributes
              to the scrollable extent). */}
          <div
            style={{
              'padding-top': `${virtualizer().spaceBefore}px`,
              'padding-bottom': `${virtualizer().spaceAfter}px`,
            }}
          >
            {/* Plain <For> is safe here: the binding exposes items as a store
                reconciled by row key, so a row's VirtualRow instance — and
                with it the DOM node scroll anchoring measures against —
                survives paging. */}
            <For each={virtualizer().items}>
              {item => (
                <ItemRow
                  item={item}
                  heightMode={heightMode()}
                  sortField={sortField() as 'created' | 'modified'}
                  permalinkID={permalinkID()}
                />
              )}
            </For>
          </div>
        </div>
      </div>

      <Show when={permalinkID()}>
        {id => <ItemDetail id={id()} onClose={() => setHash('')} />}
      </Show>

      <DevPanel
        getScrollElement={getScrollElement}
        heightMode={heightMode()}
        onHeightModeChange={setHeightMode}
        sortDirection={sortDirection() as 'asc' | 'desc'}
        anchoring={anchoring()}
        onAnchoringChange={setAnchoring}
        follow={follow()}
        onFollowChange={setFollow}
      />
    </div>
  );
}
