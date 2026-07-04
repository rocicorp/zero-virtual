# zero-virtual

Infinite virtual scroller for [Zero](https://zero.rocicorp.dev/). Rows render in
normal document flow and scroll anchoring keeps the viewport stable as rows load
— the browser's native CSS `overflow-anchor` where it's reliable, and a built-in
momentum-safe manual equivalent on iOS (auto-detected). Scrolling stays smooth
and variable / dynamic row heights work out of the box. No third-party
virtualization dependency.

Live demo at: https://gigabugs.rocicorp.dev/.

Features:

- React and SolidJS bindings over one framework-agnostic core
- Bidirectional infinite scrolling (load more items at top or bottom)
- Uniform, non-uniform, or fully dynamic (content-measured) row heights
- Element scrolling or window scrolling (`useZeroWindowVirtualizer`)
- Native or manual (momentum-safe) scroll anchoring, auto-detected per platform
- Permalink support (jump to and highlight a specific item by ID)
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
- In `native` anchoring mode, relies on the browser's CSS `overflow-anchor`
  (Chromium and Firefox; Safari doesn't implement it). The default `auto` mode
  feature-detects and falls back to `manual`, which implements the equivalent
  itself and has no such dependency.
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
- **`@rocicorp/zero-virtual/core`** — the framework-agnostic
  `ZeroVirtualizer` the wrappers share. **Experimental: this entry point is
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

export function ItemList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollState, onScrollStateChange] = useHistoryScrollState<ItemStart>();

  const {items, spaceBefore, spaceAfter} = useZeroVirtualizer({
    listContextParams: {},
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

  // Rows render in normal document flow between two spacers that stand in for
  // the not-yet-loaded rows above and below. The hook manages `overflow-anchor`
  // on the scroll container per the anchoring mode; put `overflow-anchor: none`
  // on the spacers so anchoring always targets a real row, never a spacer.
  return (
    <div ref={parentRef} style={{overflow: 'auto', height: '100vh'}}>
      <div style={{height: spaceBefore, overflowAnchor: 'none'}} />
      {items.map(({index, key, row}) => (
        <div key={key} {...rowAttributes(index, key)}>
          {row ? row.title : 'Loading...'}
        </div>
      ))}
      <div style={{height: spaceAfter, overflowAnchor: 'none'}} />
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

export function ItemList() {
  let parentRef: HTMLDivElement | undefined;
  const [scrollState, onScrollStateChange] =
    createHistoryScrollState<ItemStart>();

  const snapshot = createZeroVirtualizer(() => ({
    listContextParams: {},
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
        style={{height: `${snapshot().spaceBefore}px`, 'overflow-anchor': 'none'}}
      />
      <For each={snapshot().items}>
        {item => (
          <div {...rowAttributes(item.index, item.key)}>
            {item.row ? item.row.title : 'Loading...'}
          </div>
        )}
      </For>
      <div
        style={{height: `${snapshot().spaceAfter}px`, 'overflow-anchor': 'none'}}
      />
    </div>
  );
}
```

The window scroller is `createZeroWindowVirtualizer`, scroll persistence is
`createHistoryScrollState` (returns `[Accessor, setter]`), and stick-to-bottom
is `createStickToBottom(getScrollElement, dep, options?)` where `dep` is an
accessor that changes when content can grow at the bottom. See
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

Both hooks share a `ScrollAdapter` abstraction (`elementScrollAdapter` /
`windowScrollAdapter` are exported); provide your own to scroll a custom
container. The Solid equivalent is `createZeroWindowVirtualizer`.

### Scroll anchoring modes

The `anchoring` option controls how the viewport is kept stable as off-screen
content changes size (rows loading, dynamic heights resolving, estimates
relabeling):

- **`'auto'`** (default) — feature-detects CSS `overflow-anchor` support:
  `'native'` where the browser implements it, `'manual'` elsewhere (notably
  all of Safari).
- **`'native'`** — the browser's CSS `overflow-anchor` does the work.
- **`'manual'`** — the virtualizer pins a reference row itself and folds
  above-viewport size changes back into the scroll position. Writing
  `scrollTop` mid-momentum cancels the fling on iOS, so corrections during a
  touch gesture are instead held as a margin on the first rendered row and
  reconciled into `scrollTop` when the gesture ends.

Manual mode matches native semantics, including suppression at scroll offset 0
— content prepended while you're at the very top is revealed, not compensated
away.

### Exact row count

Without a known total, the scroll extent is estimated from the rows discovered
so far, so it keeps growing as you scroll into new rows and the scrollbar
handle jumps at page boundaries. Pass `count` whenever you can get the total
cheaply (e.g. a count query) for an accurate, stable scrollbar:

```ts
useZeroVirtualizer({count: totalRows /* ... */});
```

### Following an edge (chat / feed UIs)

Scroll anchoring keeps what you're looking at stable; it never _follows_ new
content. For a chat/log pinned to the newest message at the bottom, or a feed
at the top that should reveal newly arrived items, layer the stick-to-edge
hooks on top:

```ts
import {useStickToBottom, useStickToTop} from '@rocicorp/zero-virtual/react';

// Any value that changes when content can grow at the edge:
const tick = `${items.length}:${items[0]?.key}:${items.at(-1)?.key}:${spaceBefore}:${spaceAfter}`;

useStickToBottom(getScrollElement, tick); // chat / log
useStickToTop(getScrollElement, tick); // feed parked at the top
```

They only follow while the user is parked at that edge: scroll away and the
following stops (read history in peace); scroll back and it re-arms. For the
window scroller, pass `() => document.scrollingElement` as the element getter.
In Solid, use `createStickToBottom(getScrollElement, () => tick)`.

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

type QueryResult<TReturn> = {query: ...; options?: UseQueryOptions};
```

The `settled` flag indicates whether the list has been idle for `settleTime` ms (default 2000). Use this to vary query options based on scroll state — for example, using a shorter TTL while scrolling and a longer one when settled:

```ts
getPageQuery: ({limit, start, dir, settled}) => ({
  query: queries.item.getPageQuery({limit, start, dir}),
  options: {ttl: settled ? '5m' : '10s'},
}),
```

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
