import {createEffect, onCleanup, type Accessor} from 'solid-js';
import {
  createStickToBottomCache,
  DEFAULT_STICK_SLACK,
  type StickOptions,
} from '../core/stick-to-bottom.ts';
import type {CreateZeroVirtualizerResult} from './create-zero-virtualizer.ts';

/**
 * Stick-to-bottom for Solid: when content grows, keep the viewport pinned to
 * the bottom — but only if the user was already parked there. Mirror of the
 * React `useStickToBottom`, over the same core
 * {@linkcode createStickToBottomCache} state machine.
 *
 * The behavior is driven purely by the DOM (ResizeObservers on the rows'
 * content wrapper and the scroll container), so there are no content deps to
 * declare — the effect only wires the observers up, lazily until the
 * elements exist.
 *
 * Call during component setup (uses `onCleanup`).
 *
 * @param snapshot The accessor returned by `createZeroVirtualizer` or
 *   `createZeroWindowVirtualizer`. It supplies the scroll wiring (via
 *   `options` / `scrollElement`); the rows' content wrapper is found in the
 *   DOM.
 */
export function createStickToBottom<TRow>(
  snapshot: Accessor<CreateZeroVirtualizerResult<TRow>>,
  options: Accessor<StickOptions> = () => ({}),
): void {
  const cache = createStickToBottomCache();
  onCleanup(() => cache.detach());

  createEffect(() => {
    // Tracking the snapshot retries the lazy attach until the scroll
    // container and rows exist; after that ensure() is an identity no-op.
    const snapshotValue = snapshot();
    const {enabled = true, slack = DEFAULT_STICK_SLACK} = options();
    if (!enabled) {
      cache.detach();
      return;
    }
    cache.ensure(snapshotValue, slack);
  });
}
