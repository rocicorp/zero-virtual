import {
  createHistoryScrollState,
  createStickToBottom,
  createZeroVirtualizer,
} from '../src/solid/index.ts';
import {For, Show, createMemo} from 'solid-js';
import styles from '../demo/App.module.css';
import {DevPanel} from './DevPanel.tsx';
import {ItemDetail} from './ItemDetail.tsx';
import {ItemRow, Spacer} from './ItemRow.tsx';
import {ListHeader} from './ListHeader.tsx';
import {
  contentTickOf,
  createDemoControls,
  createEstimateSize,
  createGetPageQuery,
  createSortState,
  getRowKey,
  getSingleQuery,
  toStartRow,
} from './list-shared.ts';
import type {ItemStart} from '../demo/queries.ts';
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

  const snapshot = createZeroVirtualizer(() => ({
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

  const contentTick = createMemo(() => {
    const s = snapshot();
    return contentTickOf(s.items, s.spaceBefore, s.spaceAfter);
  });

  createStickToBottom(getScrollElement, contentTick, () => ({
    enabled: follow() === 'bottom',
  }));

  return (
    <div class={styles.page}>
      <div class={styles.list}>
        <ListHeader
          total={snapshot().total}
          estimatedTotal={snapshot().estimatedTotal}
          sortField={sortField() as 'created' | 'modified'}
          sortDirection={sortDirection() as 'asc' | 'desc'}
          onToggleSortField={toggleSortField}
          onToggleSortDirection={toggleSortDirection}
        />
        <div ref={parentRef} class={styles.viewport}>
          <Spacer height={snapshot().spaceBefore} />
          {/* Plain <For> is safe here: the binding exposes items as a store
              reconciled by row key, so a row's VirtualRow instance — and with
              it the DOM node scroll anchoring measures against — survives
              paging. */}
          <For each={snapshot().items}>
            {item => (
              <ItemRow
                item={item}
                heightMode={heightMode()}
                sortField={sortField() as 'created' | 'modified'}
                permalinkID={permalinkID()}
              />
            )}
          </For>
          <Spacer height={snapshot().spaceAfter} />
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
