# Testing

There are a number of subtle features that need to be tested manually on each release (or we need to come up with unit tests that can test them).

## Settling

`zero-virtual` supports the concept of _settling_. The scroller "settles" when there's been no scrolling OR change in the `listContext` (what list is being displayed) for `settleTime` ms.

- load the demo app and wait 2s, you should see 'settled' in the console
- load the demo app and immediately scroll slowly for 5s, then stop. you should see 'settled' 2s after you stop.
- load the demo app and immediately list queries with `await __zero.inspector.client.queries()`. you should see one query with `ttl:none`.
- load the demo app and wait 2s. then list queries. you should see one query with `ttl:5m`.
- load the demo app and wait 2s. slowly scroll down for 5s then stop. wait for 'settled' in console. list queries. you should see only two queries, both `ttl:5m`.

## Scroll State

zero-virtual has the ability to save and restore scroll state via the `scrollState` and `onScrollStateChange` params. The demo app exercises this feature using the built-in `useHistoryScrollState` hook.

When you scroll down the list and reload, the list should be reloaded exactly where you were, even if you scroll down quite far.

If you look at open queries after reload you should see only two, it shouldn't load a bunch of queries to get back to the scroll state.

If you type a new URL into the tab while looking at the demo to navigate away, then press 'back' to go back to the demo, it should load scrolled where you were.

## Permalinks

`zero-virtual` supports permalinks.

**Note:** This part is currently a little broken, see https://github.com/rocicorp/zero-virtual/issues/21.

- Click on any of the items in the demo.
- Reload.
- It should load with that item at the top of list and highlighted.
- This should work even if the item you loaded was far down the list.
- When you check queries after load you should only see three: one to find the item and two for the prev/next pages.

## scrollToItem

The dev panel has a `scrollToItem` field: an item id, an alignment, and Jump.
(Ids are opaque; click a row first — its id goes in the URL hash, and the
field falls back to the hash when left empty.)

- Jump to a row that is currently rendered: it should move immediately, and
  the open queries shouldn't change.
- Jump to a row far outside the loaded window: the list re-anchors on it and
  the scroll lands once its page arrives.
- Press Jump twice with the same id: the second press scrolls again (unlike a
  permalink, which is edge-triggered).
- Try each alignment: `auto` does nothing when the row is already fully
  visible, and otherwise scrolls the least amount needed; `start`/`center`/
  `end` place it at the top/middle/bottom, clamped at the ends of the list.
- Jump to an id that doesn't exist: nothing happens at all — same rows, same
  scroll position. A jump to a real id afterwards must still land.
- Navigate to `#does-not-exist` with the list loaded: same rule, the list is
  left alone. Load `/#does-not-exist` cold and the list still appears, from
  the top.
- After a jump that clamps (e.g. `center` on the first row), scrolling should
  still page normally — a stuck request would stand paging down.
- Known rough edge: a jump that lands while its window is still streaming in
  leaves the viewport at the window's edge, and paging then tops the window up
  from above — on a slow (cold) cache that can walk the window far enough to
  unload the row you jumped to. Worth watching when touching `#evaluatePaging`.
- Switch the container to `Window scroll` and jump with `start`: the row must
  land just below the sticky header, not behind it (the demo keeps
  `scroll-padding-top` on the document in sync with the header's height).

## Releasing

Releases are published to npm automatically via CI when a version tag is pushed. To cut a new patch release:

```sh
git checkout main
git reset --hard origin/main
pnpm version patch
git push
git push --tags
```

Use `pnpm version minor` or `pnpm version major` for larger releases.
