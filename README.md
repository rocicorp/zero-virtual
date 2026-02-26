# zero-virtual

Infinite virtual scroller for [Zero](https://zero.rocicorp.dev/). Built on top of [Tanstack Virtual](https://tanstack.com/virtual/latest).

Features:

- Bidirectional infinite scrolling (load more items at top or bottom)
- Permalink support (jump to and highlight a specific item by ID)
- State persistence (restore scroll position across navigation)
- Dynamic page sizing based on viewport

## Restrictions

- Only fixed row heights are currently supported.

## Usage

This guide explains how to add `@rocicorp/zero-virtual` to your own Zero app, using the [demo](demo/) as a reference.

### Prerequisites

A working Zero setup. See [Hello Zero](https://github.com/rocicorp/hello-zero) for a minimal starting point.

### Setup

**1. Install**

```sh
npm install @rocicorp/zero-virtual
```

**2. Define your page and single-row queries**

`useZeroVirtualizer` fetches rows in pages and can also look up a single row by ID for permalink support. Define these using Zero's `defineQuery` / `defineQueries` helpers. See [demo/queries.ts](demo/queries.ts) for an example:

```ts
import { defineQueries, defineQuery } from "@rocicorp/zero";
import { zql } from "./schema.ts";

export type ItemStart = Pick<Item, "id" | "created">;

export const queries = defineQueries({
  item: {
    // Fetches a single item by ID (used for permalink resolution)
    getSingleQuery: defineQuery(({ args: { id } }: { args: { id: string } }) =>
      zql.item.where("id", id).one(),
    ),

    // Fetches a page of items given pagination parameters
    getPageQuery: defineQuery(
      ({
        args: { limit, start, dir },
      }: {
        args: {
          limit: number;
          start: ItemStart | null;
          dir: "forward" | "backward";
        };
      }) => {
        let q = zql.item
          .limit(limit)
          .orderBy("created", dir === "forward" ? "desc" : "asc");
        if (start) {
          q = q.start(start, { inclusive: false });
        }
        return q;
      },
    ),
  },
});
```

**3. Use `useZeroVirtualizer` in your component**

```tsx
import { useZeroVirtualizer } from "@rocicorp/zero-virtual/react";
import { useCallback, useMemo, useRef } from "react";

function getRowKey(item: Item) {
  return item.id;
}

function toStartRow(item: Item): ItemStart {
  return { id: item.id, created: item.created };
}

export function ItemList() {
  const parentRef = useRef<HTMLDivElement>(null);

  const { virtualizer, rowAt } = useZeroVirtualizer({
    listContextParams: {},
    getScrollElement: useCallback(() => parentRef.current, []),
    estimateSize: useCallback(() => 48, []),
    getRowKey,
    toStartRow,
    getPageQuery: useCallback(
      (limit, start, dir) => queries.item.getPageQuery({ limit, start, dir }),
      [],
    ),
    getSingleQuery: useCallback(
      (id) => queries.item.getSingleQuery({ id }),
      [],
    ),
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} style={{ overflow: "auto", height: "100vh" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualItems.map((virtualRow) => {
          const row = rowAt(virtualRow.index);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row ? row.title : "Loading..."}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

For a complete working example including sorting, permalinks, and scroll-position persistence, see [demo/App.tsx](demo/App.tsx).

## Running the demo

First, install dependencies from the repo root:

```sh
pnpm i
```

Then `cd` into the demo directory for the remaining steps:

```sh
cd demo
```

Run Docker:

```sh
pnpm dev:db-up
```

**In a second terminal**, run the zero-cache server:

```sh
cd demo
pnpm dev:zero-cache
```

**In a third terminal**, run the Vite dev server:

```sh
cd demo
pnpm dev:ui
```
