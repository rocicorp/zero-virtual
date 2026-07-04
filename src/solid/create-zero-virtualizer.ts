import {
  createComputed,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
} from 'solid-js';
import {createEffect} from 'solid-js';
import {createStore, reconcile} from 'solid-js/store';
import {
  elementScrollAdapter,
  windowScrollAdapter,
  type ScrollAdapter,
} from '../core/scroll-adapter.ts';
import type {GetPageQuery, GetSingleQuery, VirtualRow} from '../core/types.ts';
import {
  ZeroVirtualizer,
  type VirtualizerOptions,
  type VirtualizerSnapshot,
} from '../core/virtualizer.ts';
import {createRows} from './create-rows.ts';

/**
 * Options for {@linkcode createZeroVirtualizer}: the core
 * {@linkcode VirtualizerOptions} plus the Solid-side wiring — the scroll
 * element getter, the query functions (bound via `@rocicorp/zero/solid`),
 * and an optional custom scroll adapter.
 */
export type CreateZeroVirtualizerOptions<TListContextParams, TRow, TStartRow> =
  VirtualizerOptions<TListContextParams, TRow, TStartRow> & {
    /** Returns the scrollable container element (a Solid ref). */
    getScrollElement: () => HTMLElement | null;
    /** Function that returns a query for fetching a page of rows */
    getPageQuery: GetPageQuery<TRow, TStartRow>;
    /** Function that returns a query for fetching a single row by ID */
    getSingleQuery: GetSingleQuery<TRow>;
    /** Function to extract the start row data from a full row */
    toStartRow: (row: TRow) => TStartRow;
    /**
     * How the scroll container is read and driven. Defaults to
     * {@linkcode elementScrollAdapter}; pass {@linkcode windowScrollAdapter}
     * for a list that scrolls the window.
     */
    scrollAdapter?: ScrollAdapter | undefined;
  };

/**
 * Solid binding for the Zero virtualizer: a thin reactive shell over the
 * framework-agnostic {@linkcode ZeroVirtualizer} core (the same core the
 * React hook uses).
 *
 * Returns an accessor of the current snapshot. The snapshot itself is
 * coarse-grained (its identity only changes when content does), but `items`
 * is a store reconciled by row key: a {@linkcode VirtualRow} keeps its
 * instance while its key stays in the list, so a plain `<For>` preserves row
 * DOM across paging — which is what scroll anchoring measures against.
 *
 * Call during component setup (uses `onCleanup`).
 */
export function createZeroVirtualizer<TListContextParams, TRow, TStartRow>(
  options: Accessor<
    CreateZeroVirtualizerOptions<TListContextParams, TRow, TStartRow>
  >,
): Accessor<VirtualizerSnapshot<TRow>> {
  const initial = options();
  const adapter = initial.scrollAdapter ?? elementScrollAdapter;
  // The constructor is pure (no DOM / listeners / timers), so eager
  // construction during setup is safe.
  const core = new ZeroVirtualizer<TListContextParams, TRow, TStartRow>(
    initial,
    adapter,
  );

  // Bridge core-driven changes (scroll, timers, transitions) into Solid's
  // reactive graph.
  const [version, setVersion] = createSignal(0);
  const unsubscribe = core.subscribe(() => setVersion(v => v + 1));
  onCleanup(() => {
    unsubscribe();
    core.detach();
  });

  // Silent staging — createComputed runs during the render phase, before
  // effects, mirroring the React wrapper's render-time setOptions/setRows.
  createComputed(() => core.setOptions(options()));

  const inputs = createMemo(() => {
    version();
    options();
    return core.getQueryInputs();
  });

  const rows = createRows<TRow, TStartRow>({
    inputs,
    getPageQuery: () => options().getPageQuery,
    getSingleQuery: () => options().getSingleQuery,
    toStartRow: () => options().toStartRow,
  });
  createComputed(() => core.setRows(rows()));

  // Post-DOM-update pass: Solid effects run after the DOM is patched (still
  // pre-paint) — the `useLayoutEffect` slot of the React wrapper.
  createEffect(() => {
    version();
    rows();
    core.attach(options().getScrollElement());
    core.afterDOMUpdate();
  });

  const snapshot = createMemo(() => {
    version();
    rows();
    options();
    return core.getSnapshot();
  });

  // Keyed projection of the snapshot's items. The core rebuilds every
  // VirtualRow wrapper when the loaded window changes, so reference-keyed
  // rendering (`<For>`) would recreate all row DOM on each page load.
  // Reconciling into a store keyed by row key keeps each wrapper's instance
  // stable (the same approach as @tanstack/solid-virtual). Zero's Solid
  // useQuery already keeps row references stable, so an unchanged `row` is
  // referentially equal and short-circuits the diff.
  const [items, setItems] = createStore<VirtualRow<TRow>[]>([]);
  createComputed(() =>
    setItems(reconcile(snapshot().items as VirtualRow<TRow>[], {key: 'key'})),
  );

  return createMemo(() => ({...snapshot(), items}));
}

/**
 * Like {@linkcode createZeroVirtualizer}, but the list scrolls the window
 * rather than an overflow element (`getScrollElement` returns the element the
 * rows are rendered into; the window is the scroll container).
 */
export function createZeroWindowVirtualizer<
  TListContextParams,
  TRow,
  TStartRow,
>(
  options: Accessor<
    CreateZeroVirtualizerOptions<TListContextParams, TRow, TStartRow>
  >,
): Accessor<VirtualizerSnapshot<TRow>> {
  return createZeroVirtualizer(() => ({
    scrollAdapter: windowScrollAdapter,
    ...options(),
  }));
}
