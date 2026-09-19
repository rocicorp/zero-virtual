# zero-virtual

Infinite virtual scroller for [Zero](https://zero.rocicorp.dev/). Rows render in
normal document flow and scroll anchoring keeps the viewport stable as rows
load using the browser's native CSS `overflow-anchor` where it's reliable, and
a built-in momentum-safe manual equivalent on iOS (auto-detected). Scrolling
stays smooth and variable / dynamic row heights work out of the box. No
third-party virtualization dependency.

Live demo at: https://gigabugs.rocicorp.dev/.

Features:

- **React** and **SolidJS** bindings over one framework-agnostic core
- Bidirectional infinite scrolling (load more items at top or bottom)
- Uniform, non-uniform, or fully dynamic (content-measured) row heights
- Element scrolling or window scrolling (`useZeroWindowVirtualizer`)
- Native or manual (momentum-safe) scroll anchoring, auto-detected per platform
- Permalink support (jump to and highlight a specific item by ID)
- Imperative `scrollToItem(id, {align})`, loading the row's page if needed
- State persistence (restore scroll position across navigation)
- Exact `count` support for an accurate, stable scrollbar
- Stick-to-bottom helper (`useStickToBottom`) for chat / log UIs
- Dynamic page sizing based on viewport
- No third-party virtualization dependency

## Restrictions

- Vertical lists only.
- **Browser support: Chromium 114+, Firefox 109+, Safari 26+.** The floor is
  the native `scrollend` event, which the manual anchoring relies on to
  reconcile momentum-time corrections at the end of a touch gesture (there is
  deliberately no timer-based fallback for older engines).
- The provided history-state helpers (`useHistoryScrollState` /
  `createHistoryScrollState`) additionally rely on the
  [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API),
  which needs **Firefox 147+** (the Chromium and Safari floors above already
  include it). Older Firefox runs the rest of the library fine — just wire
  `scrollState` / `onScrollStateChange` to a persistence mechanism of your
  own (e.g. `history.replaceState` or `sessionStorage`) instead of using the
  helpers.
- In `native` anchoring mode, relies on the browser's CSS `overflow-anchor`
  (Chromium and Firefox; Safari implements it but doesn't enable it by default
  as of July 2026). The default `auto` mode feature-detects and falls back to
  `manual`, which implements the equivalent itself and has no such dependency.
- Without `count`, the scrollbar is approximate: off-screen extent is sized
  from `estimateSize` and grows as rows are discovered (as with any virtualized
  list of unknown length). Visible content is always positioned exactly.

## Entry points

- **`@rocicorp/zero-virtual/react`** — the React hooks (this guide).
- **`@rocicorp/zero-virtual/solid`** — the SolidJS bindings:
  `createZeroVirtualizer` / `createZeroWindowVirtualizer`,
  `createHistoryScrollState`, `createStickToBottom`. Same options and
  snapshot shape as React, with accessors in the reactive slots (query
  functions are bound via `@rocicorp/zero/solid`).
- **`@rocicorp/zero-virtual/core`** — the framework- and library-agnostic
  `ZeroVirtualizer` the wrappers share. It has no dependency on
  `@rocicorp/zero` — the query types are opaque generics — so bindings can
  pair it with any fetching library. **Experimental: this entry point is
  public so you can build bindings for other frameworks, but its API may
  change in breaking ways in any release while it settles.**

## Usage

This guide explains how to add `@rocicorp/zero-virtual` to your own Zero app, using the [React demo](demo/react/) as a reference. The walkthrough uses the React hooks; the [SolidJS section](#solidjs) below shows the same wiring with the Solid bindings (a full Solid port of the demo lives in [demo/solid](demo/solid/)).

### Prerequisites

A working Zero setup. See [Hello Zero](https://github.com/rocicorp/hello-zero) for a minimal starting point.

### Setup

**1. Install**

```sh
npm install @rocicorp/zero-virtual
```

**2. Define your page and single-row queries**

`useZeroVirtualizer` fetches rows in pages and can also look up a single row by ID for permalink support. Define these using Zero's `defineQuery` / `defineQueries` helpers. See [demo/shared/queries.ts](demo/shared/queries.ts) for an example:

```ts
import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql} from './schema.ts';

export type ItemStart = Pick<Item, 'id' | 'created'>;

export const queries = defineQueries({
  item: {
    // Fetches a single item by ID (used for permalink resolution)
    getSingleQuery: defineQuery(({args: {id}}: {args: {id: string}}) =>
      zql.item.where('id', id).one(),
    ),

    // Fetches a page of items given pagination parameters
    getPageQuery: defineQuery(
      ({
        args: {limit, start, dir},
      }: {
        args: {
          limit: number;
          start: ItemStart | null;
          dir: 'forward' | 'backward';
        };
      }) => {
        let q = zql.item
          .limit(limit)
          .orderBy('created', dir === 'forward' ? 'desc' : 'asc');
        if (start) {
          q = q.start(start, {inclusive: false});
        }
        return q;
      },
    ),
  },
});
```

**3. Use `useZeroVirtualizer` in your component**

```tsx
import {
  rowAttributes,
  useZeroVirtualizer,
  useHistoryScrollState,
} from '@rocicorp/zero-virtual/react';
import {useCallback, useRef} from 'react';

function getRowKey(item: Item) {
  return item.id;
}

function toStartRow(item: Item): ItemStart {
  return {id: item.id, created: item.created};
}

// listContextParams identifies the sort/filter context the list is showing.
// It is compared by identity (===): a new reference means "new context" and
// resets the list (anchor and scroll position). Pass a stable reference — a
// module constant like this, or `useMemo` when it's derived from state —
// never an inline object literal.
const listContextParams = {};

export function ItemList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollState, onScrollStateChange] = useHistoryScrollState<ItemStart>();

  const {items, spaceBefore, spaceAfter} = useZeroVirtualizer({
    listContextParams,
    getScrollElement: useCallback(() => parentRef.current, []),
    estimateSize: useCallback(() => 48, []),
    getRowKey,
    toStartRow,
    getPageQuery: useCallback(
      ({limit, start, dir}) => ({
        query: queries.item.getPageQuery({limit, start, dir}),
      }),
      [],
    ),
    getSingleQuery: useCallback(
      ({id}) => ({
        query: queries.item.getSingleQuery({id}),
      }),
      [],
    ),
    scrollState,
    onScrollStateChange,
  });

  // Rows render in normal document flow inside a content wrapper. The
  // not-yet-loaded rows above and below are stood in for by spacer elements
  // sized `spaceBefore` / `spaceAfter`, so scroll anchoring keeps the viewport
  // stable across paging. The hook manages `overflow-anchor` on the scroll
  // container per the anchoring mode.
  return (
    <div ref={parentRef} style={{overflow: 'auto', height: '100vh'}}>
      <div>
        <div style={{height: spaceBefore}} />
        {items.map(({index, key, row}) => (
          <div key={key} {...rowAttributes(index, key)}>
            {row ? row.title : 'Loading...'}
          </div>
        ))}
        <div style={{height: spaceAfter}} />
      </div>
    </div>
  );
}
```

`rowAttributes(index, key)` stamps each row with the `data-vrow-index` /
`data-vrow-key` attributes the hook uses to measure which rows are visible (to
trigger paging), pick its anchoring reference, and locate a permalink target.
Every row — including loading placeholders — must carry them.

### SolidJS

`@rocicorp/zero-virtual/solid` exposes the same functionality over Solid's
reactive primitives (query functions are bound via `@rocicorp/zero/solid`).
The differences from the React hook:

- Options are passed as an **accessor**; any signals read inside it
  re-evaluate the options reactively (the equivalent of hook deps).
- The result is an **accessor of the snapshot** — same fields as React.
- `items` is a store reconciled by row key: a row's `VirtualRow` instance is
  stable while its key stays in the list, so a plain `<For>` preserves row
  DOM across paging (which is what scroll anchoring measures against).

```tsx
import {For} from 'solid-js';
import {
  createHistoryScrollState,
  createZeroVirtualizer,
  rowAttributes,
} from '@rocicorp/zero-virtual/solid';

// Compared by identity, exactly as in React (see above): keep the reference
// stable — a module constant, or a memo when derived from signals — since the
// options accessor re-runs on every reactive update.
const listContextParams = {};

export function ItemList() {
  let parentRef: HTMLDivElement | undefined;
  const [scrollState, onScrollStateChange] =
    createHistoryScrollState<ItemStart>();

  const snapshot = createZeroVirtualizer(() => ({
    listContextParams,
    getScrollElement: () => parentRef ?? null,
    estimateSize: () => 48,
    getRowKey,
    toStartRow,
    getPageQuery: ({limit, start, dir}) => ({
      query: queries.item.getPageQuery({limit, start, dir}),
    }),
    getSingleQuery: ({id}) => ({
      query: queries.item.getSingleQuery({id}),
    }),
    scrollState: scrollState(),
    onScrollStateChange,
  }));

  return (
    <div ref={parentRef} style={{overflow: 'auto', height: '100vh'}}>
      <div
        style={{
          'padding-top': `${snapshot().spaceBefore}px`,
          'padding-bottom': `${snapshot().spaceAfter}px`,
        }}
      >
        <For each={snapshot().items}>
          {item => (
            <div {...rowAttributes(item.index, item.key)}>
              {item.row ? item.row.title : 'Loading...'}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
```

The window scroller is `createZeroWindowVirtualizer`, scroll persistence is
`createHistoryScrollState` (returns `[Accessor, setter]`), and stick-to-bottom
is `createStickToBottom(snapshot, options?, deps?)` where `snapshot` is the
accessor returned by the virtualizer. See
[demo/solid/App.tsx](demo/solid/App.tsx) for all of them in one place.

### Element vs window scrolling

`useZeroVirtualizer` scrolls inside an overflow element — `getScrollElement`
returns that element. To scroll the **window** instead, use
`useZeroWindowVirtualizer` with the exact same options and render shape; here
`getScrollElement` returns the element the rows are rendered into (which lives in
normal page flow), and the window is the scroll container:

```tsx
import {useZeroWindowVirtualizer} from '@rocicorp/zero-virtual/react';

const {items, spaceBefore, spaceAfter} = useZeroWindowVirtualizer({
  /* ...same options... */
});
```

Both hooks accept TanStack-style scroll wiring directly in their options:
`getScrollElement` plus optional `observeElementRect` / `observeElementOffset`
overrides. They default per hook — the defaults are exported as
`observeElementRect` / `observeElementOffset` and their window twins
`observeWindowRect` / `observeWindowOffset`. Override them to observe a
custom container. The result echoes the resolved wiring as `options` and
exposes the current scrolling element as `scrollElement`, also TanStack-style.
The Solid equivalent is `createZeroWindowVirtualizer`.

### Scroll anchoring modes

The `anchoring` option controls how the viewport is kept stable as off-screen
content changes size (rows loading, dynamic heights resolving, estimates
relabeling):

- **`'auto'`** (default) — feature-detects CSS `overflow-anchor` support:
  `'native'` where the browser implements it, `'manual'` elsewhere (notably
  Safari, which as of July 2026 implements but does not enable it by default).
- **`'native'`** — the browser's CSS `overflow-anchor` does the work.
- **`'manual'`** — the virtualizer pins a reference row itself and folds
  above-viewport size changes back into the scroll position. Writing
  `scrollTop` mid-momentum cancels the fling on iOS, so corrections during a
  touch gesture are instead held as a margin on the content wrapper and
  reconciled into `scrollTop` when the gesture ends.

Manual mode matches native semantics, including suppression at scroll offset 0
— content prepended while you're at the very top is revealed, not compensated
away.

### Jumping to a row

The result carries a `scrollToItem(id, options?)` for bringing a specific row
into view — a "jump to item" button, a search hit, a notification:

```ts
const virtualizer = useZeroVirtualizer({
  /* ... */
});

virtualizer.scrollToItem('item-123'); // scrolls the least amount needed
virtualizer.scrollToItem('item-123', {align: 'center'});
```

`id` is the same identifier the `permalinkID` option takes — whatever
`getSingleQuery` resolves — which need not equal `getRowKey(row)`. A row that
is already loaded is scrolled to immediately; anything else re-anchors paging
on the target (exactly as a permalink navigation does) and the scroll lands
once its page has loaded. An id that resolves to no row does nothing at all:
the row is looked up before the list is re-anchored on it, so a stale or
mistyped id leaves what is on screen exactly as it was.

The same goes for `permalinkID` — pointing it at an id that doesn't exist
leaves a loaded list alone. (On a cold load there is no list to keep, so it
falls back to the top of the list.)

`align` follows TanStack Virtual's `scrollToIndex`: `'auto'` (the default)
scrolls the minimum needed to bring the row into view and does nothing when it
is already fully visible, or `'start'` / `'center'` / `'end'` to place it at the
top, middle or bottom. Every alignment is clamped by the scroll container.

Alignment follows the same contract as native `scrollIntoView`, from both
sides: the scrollport is inset by the scroll container's CSS `scroll-padding`
(how a sticky header is normally declared — "this strip of me is covered"), and
the row is outset by its own `scroll-margin` ("keep this much space around
me"). Either keeps a top-aligned row out from under a sticky header; the
container-side one is usually what you want, since it is a single declaration
rather than one per row. For a window-scrolled list the scroll container is the
document, so the declaration goes there — see
[demo/react/WindowList.module.css](demo/react/WindowList.module.css).

Unlike `permalinkID` — which is declarative and edge-triggered, so the same id
twice does nothing — `scrollToItem` always scrolls. There is no
`behavior: 'smooth'`: the scroll is re-applied on every commit while the
target's page streams in, which a smooth animation would fight.

The callback's identity is stable for the lifetime of the virtualizer, so it is
safe in a dependency array.

### Exact row count

Without a known total, the scroll extent is estimated from the rows discovered
so far, so it keeps growing as you scroll into new rows and the scrollbar
handle jumps at page boundaries. Pass `count` whenever you can get the total
cheaply (e.g. a count query) for an accurate, stable scrollbar:

```ts
useZeroVirtualizer({count: totalRows /* ... */});
```

### Following the bottom (chat / log UIs)

Scroll anchoring keeps what you're looking at stable; it never _follows_ new
content. For a chat/log pinned to the newest message at the bottom, layer the
stick-to-bottom hook on top:

```ts
import {useStickToBottom} from '@rocicorp/zero-virtual/react';

// `virtualizer` is the object returned by useZeroVirtualizer or
// useZeroWindowVirtualizer.
useStickToBottom(virtualizer);
```

It only follows while the user is parked at the bottom: scroll away and the
following stops (read history in peace); scroll back down and it re-arms. The
hook reuses the virtualizer's scroll wiring (via `virtualizer.options` /
`virtualizer.scrollElement`), so it works unchanged with window scrolling.

The full signature is `useStickToBottom(virtualizer, options?)`, with
`enabled` and `slack` in the options. Re-pinning is driven purely by the DOM
— ResizeObservers on the rows' content wrapper and the scroll container — so
_any_ growth at the bottom re-pins, including content the virtualizer doesn't
know about, like the last row streaming in taller. There are no content deps
to declare.

In Solid, use `createStickToBottom(snapshot, options?)` with accessors in the
reactive slots.

A feed parked at the top needs no helper: at scroll offset 0, scroll anchoring
(native and manual alike) deliberately stands down, so newly prepended content
is revealed rather than compensated away.

### Query functions

Query functions receive an options object and return a `QueryResult`:

```ts
type GetPageQueryOptions<TStartRow> = {
  limit: number;
  start: TStartRow | null;
  dir: 'forward' | 'backward';
  settled: boolean;
};

type GetSingleQueryOptions = {
  id: string;
  settled: boolean;
};

type QueryResult<TReturn> = {query: ...; options?: QueryOptions};
// QueryOptions ({enabled?, ttl?}) is structurally assignable to the
// UseQueryOptions of @rocicorp/zero/react and @rocicorp/zero/solid.
```

The `settled` flag indicates whether the list has been idle for `settleTime` ms (default 2000). Use this to vary query options based on scroll state — for example, using a shorter TTL while scrolling and a longer one when settled:

```ts
getPageQuery: ({limit, start, dir, settled}) => ({
  query: queries.item.getPageQuery({limit, start, dir}),
  options: {ttl: settled ? '5m' : '10s'},
}),
```

### Page size

The `limit` passed to `getPageQuery` comes from the page size: about three
viewports' worth of rows at `estimateSize`, but never below the `minPageSize`
floor (default 50). The floor is sized for short rows; for tall rows (cards,
comments) 50 rows is many viewports of content, so the floor dominates the
formula and each page load renders far more DOM than needed — showing up as
long tasks when a page lands mid-scroll. Lower it so page size tracks the
viewport again:

```ts
useZeroVirtualizer({
  estimateSize: () => 200, // tall cards
  minPageSize: 20,
  // ...
});
```

Smaller pages trade a few more query round trips for smaller, smoother
per-page render bursts. The page size never shrinks once grown, and is rounded
up to an even number (paging splits pages in half around permalinks).

### Scroll settling

`useZeroVirtualizer` tracks whether the user has stopped scrolling:

- **`settled`** (returned) — `true` when the list has been idle for `settleTime` ms
- **`settleTime`** (option) — how long to wait before considering the list settled (default 2000ms)
- **`onSettled`** (option) — callback fired when `settled` transitions to `true`, useful for deferred side effects like syncing search params to the URL

### `useHistoryScrollState`

A ready-made hook that persists the virtualizer's scroll/pagination state in `window.history.state`, so back/forward navigation restores position automatically. Pass its results to the `scrollState` and `onScrollStateChange` options:

```ts
const [scrollState, onScrollStateChange] = useHistoryScrollState<MyStartRow>();
```

Pass a custom `key` if you have multiple virtualizers on the same page:

```ts
const [scrollState, onScrollStateChange] =
  useHistoryScrollState<MyStartRow>('myList');
```

The Solid mirror is `createHistoryScrollState` — same key parameter, with the
state returned as an accessor.

The state these return changes only when the _browser_ navigates: a load, a
reload, or a back/forward. What the setter writes does not come back through
it. The two directions mean different things — the setter records where the
viewport ended up, the state says where to put it — so a write echoed back
would arrive as an instruction to return to a position the list has often
already left (a `scrollToItem` landing, a permalink resolving). If you write
your own persistence layer instead, hold it to the same rule: feed
`scrollState` a new value when the user navigated, not when
`onScrollStateChange` fired.

These helpers store through the Navigation API, which structured-clones, and
they never look inside the state they carry — so what `toStartRow` returns
only has to be JSON-serializable if you leave the virtualizer comparing start
rows structurally. See [`compareStartRows`](#comparestartrows) below.

### `compareStartRows`

The virtualizer compares paging anchors to tell one position from another, and
by default it does that structurally, with `JSON.stringify`. Pass
`compareStartRows` to do it with your own comparator instead:

```ts
useZeroVirtualizer({
  compareStartRows: (a, b) =>
    a.rowid < b.rowid ? -1 : a.rowid > b.rowid ? 1 : 0,
  // ...
});
```

It takes the same shape as the comparators Zero uses — negative, zero,
positive — so you can hand over the one you already sort this list by. Only
the zero is read: the virtualizer never sorts, it just needs to know whether
two anchors point at the same row.

Reach for it when your start rows aren't JSON-serializable, or when a
structural comparison would be wrong or wasteful for them.

**What this does and doesn't lift.** With `compareStartRows`, an int64 column
read as a `bigint` survives the whole round trip in React: the core never
stringifies a start row, `useHistoryScrollState` never looks inside the state
it carries, and the Navigation API structured-clones. Without it, narrow the
column in `toStartRow` (`Number(row.id)`, `String(row.id)`) and widen it again
in `getPageQuery`.

Two things are unaffected either way:

- `listContextParams` is always compared structurally, so it has to be
  JSON-serializable whatever you pass here.
- `createHistoryScrollState`, the Solid helper, round-trips what it stores
  through JSON. Zero's Solid bindings hand out store proxies and the Navigation
  API refuses to clone those, so the round trip is what turns them back into
  plain data — and a `bigint` doesn't survive it. On Solid, narrow in
  `toStartRow` or persist the state yourself.

Nothing else in `history.state` is ever inspected — another library's key, a
router's location state — so none of it has to be JSON-serializable either.

Both helpers are built on the Navigation API
(`navigation.updateCurrentEntry`), which requires **Firefox 147+**; every
Chromium and Safari version this library supports already has it. On older
Firefox they throw at first use, but nothing else in the library depends on
them: `scrollState` / `onScrollStateChange` accept any implementation, so you
can persist the state through `history.replaceState`, `sessionStorage`, a
router's location state, or anything else that survives navigation.

For a complete working example including sorting, permalinks, and scroll-position persistence, see [demo/react/App.tsx](demo/react/App.tsx) — or its Solid twin, [demo/solid/App.tsx](demo/solid/App.tsx).

## Running the demo

First, install dependencies from the repo root:

```sh
pnpm i
```

The demo is split into three packages: the shared stack (postgres, zero-cache,
API handlers) in `demo/shared`, and two front ends over it — `demo/react` and
`demo/solid`.

Run Docker:

```sh
cd demo/shared
pnpm dev:db-up
```

**In a second terminal**, run the zero-cache server:

```sh
cd demo/shared
pnpm dev:zero-cache
```

**In a third terminal**, run the Vite dev server for the React demo:

```sh
cd demo/react
pnpm dev:ui
```

or for the SolidJS demo (they can run side by side):

```sh
cd demo/solid
pnpm dev:ui
```

## Other Examples

- https://github.com/rocicorp/ztunes (live at https://ztunes.rocicorp.dev/)
- https://github.com/rocicorp/mono/tree/main/apps/zbugs (live at https://gigabugs.rocicorp.dev/)
