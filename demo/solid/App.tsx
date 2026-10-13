import {
  createHistoryScrollState,
  createStickToBottom,
  createZeroVirtualizer,
  laneAttributes,
} from '../../src/solid/index.ts';
import {For, Show, createMemo} from 'solid-js';
import styles from '../shared/App.module.css';
import {DevPanel} from './DevPanel.tsx';
import {ItemDetail} from './ItemDetail.tsx';
import {ItemRow} from './ItemRow.tsx';
import {ListHeader} from './ListHeader.tsx';
import {
  contentWrapperProps,
  createDemoControls,
  createEstimateSize,
  createGetPageQuery,
  createSortState,
  getRowKey,
  getSingleQuery,
  toStartRow,
} from './list-shared.ts';
import {layoutValue} from '../shared/layout.ts';
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
    lanes,
    masonry,
    setLayout,
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
    lanes: lanes(),
    masonry: masonry(),
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
          <Show
            when={!masonry()}
            fallback={
              // Masonry: one element per lane, each with its own cards, and
              // no spacers — the virtualizer pads the lanes itself.
              <div class={styles.masonry}>
                <For each={Array.from({length: lanes()}, (_, lane) => lane)}>
                  {lane => (
                    <div {...laneAttributes(lane)} class={styles.lane}>
                      <For
                        each={virtualizer().items.filter(
                          item => item.lane === lane,
                        )}
                      >
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
                  )}
                </For>
              </div>
            }
          >
            {/* Content wrapper. `spaceBefore` / `spaceAfter` stand in for the
              unloaded rows above and below, rendered as spacer elements
              (spanning every column when `lanes` makes the wrapper a grid)
              so scroll anchoring keeps the viewport stable across paging. */}
            <div {...contentWrapperProps(lanes())}>
              <div
                style={{
                  'height': `${virtualizer().spaceBefore}px`,
                  'grid-column': '1 / -1',
                }}
              />
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
              <div
                style={{
                  'height': `${virtualizer().spaceAfter}px`,
                  'grid-column': '1 / -1',
                }}
              />
            </div>
          </Show>
        </div>
      </div>

      <Show when={permalinkID()}>
        {id => <ItemDetail id={id()} onClose={() => setHash('')} />}
      </Show>

      <DevPanel
        getScrollElement={getScrollElement}
        heightMode={heightMode()}
        onHeightModeChange={setHeightMode}
        layout={layoutValue({lanes: lanes(), masonry: masonry()})}
        onLayoutChange={setLayout}
        sortDirection={sortDirection() as 'asc' | 'desc'}
        anchoring={anchoring()}
        onAnchoringChange={setAnchoring}
        follow={follow()}
        onFollowChange={setFollow}
      />
    </div>
  );
}
