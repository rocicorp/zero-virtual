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
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  resolveElementScrollElement,
  resolveWindowScrollElement,
  type ResolvedScrollOptions,
  type ResolveScrollElement,
} from '../core/scroll.ts';
import type {VirtualRow} from '../core/types.ts';
import {
  virtualizerResult,
  ZeroVirtualizer,
  type VirtualizerResult,
} from '../core/virtualizer.ts';
import type {VirtualizerBindingOptions} from '../zero-types.ts';
import {createRows} from './create-rows.ts';

/**
 * Options for {@linkcode createZeroVirtualizer}: the core options (see
 * {@linkcode VirtualizerBindingOptions}) plus the Solid-side wiring — the
 * scroll element getter, the query functions (bound via
 * `@rocicorp/zero/solid`), and optional overrides of the scroll observers
 * (TanStack Virtual style).
 */
export type CreateZeroVirtualizerOptions<TListContextParams, TRow, TStartRow> =
  VirtualizerBindingOptions<TListContextParams, TRow, TStartRow>;

/**
 * Result of {@linkcode createZeroVirtualizer}: the snapshot plus the resolved
 * scroll wiring (`options`) and the current scrolling element
 * (`scrollElement`, a live getter — not a reactive source). See
 * {@linkcode VirtualizerResult} for field semantics.
 */
export type CreateZeroVirtualizerResult<TRow> = VirtualizerResult<TRow>;

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
function createZeroVirtualizerImpl<TListContextParams, TRow, TStartRow>(
  // The binding options with the observers already defaulted (the entry
  // points below spread them in, TanStack style).
  options: Accessor<
    CreateZeroVirtualizerOptions<TListContextParams, TRow, TStartRow> &
      ResolvedScrollOptions
  >,
  resolveScrollElement: ResolveScrollElement,
): Accessor<CreateZeroVirtualizerResult<TRow>> {
  // The constructor is pure (no DOM / listeners / timers), so eager
  // construction during setup is safe.
  const core = new ZeroVirtualizer<TListContextParams, TRow, TStartRow>(
    options(),
    resolveScrollElement,
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

  // Memoizing each member first (memos only propagate on `!==`) keeps the
  // options bag's identity stable while the members' identities are.
  const getScrollElement = createMemo(() => options().getScrollElement);
  const observeRect = createMemo(() => options().observeElementRect);
  const observeOffset = createMemo(() => options().observeElementOffset);
  const resultOptions = createMemo(() => ({
    getScrollElement: getScrollElement(),
    observeElementRect: observeRect(),
    observeElementOffset: observeOffset(),
  }));

  return createMemo(() =>
    virtualizerResult(
      {...snapshot(), items},
      resultOptions(),
      resolveScrollElement,
    ),
  );
}

/**
 * Virtualized, infinitely-paginated list that scrolls inside an overflow
 * element. `getScrollElement` returns that element (which is also where the
 * rows are rendered).
 */
export function createZeroVirtualizer<TListContextParams, TRow, TStartRow>(
  options: Accessor<
    CreateZeroVirtualizerOptions<TListContextParams, TRow, TStartRow>
  >,
): Accessor<CreateZeroVirtualizerResult<TRow>> {
  return createZeroVirtualizerImpl(() => {
    const o = options();
    return {
      ...o,
      observeElementRect: o.observeElementRect ?? observeElementRect,
      observeElementOffset: o.observeElementOffset ?? observeElementOffset,
    };
  }, resolveElementScrollElement);
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
): Accessor<CreateZeroVirtualizerResult<TRow>> {
  return createZeroVirtualizerImpl(() => {
    const o = options();
    return {
      ...o,
      observeElementRect: o.observeElementRect ?? observeWindowRect,
      observeElementOffset: o.observeElementOffset ?? observeWindowOffset,
    };
  }, resolveWindowScrollElement);
}
