import {createEffect, onCleanup, type Accessor} from 'solid-js';
import {
  contentGrowthDeps,
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
 * Call during component setup (uses `onCleanup`).
 *
 * @param snapshot The accessor returned by `createZeroVirtualizer` or
 *   `createZeroWindowVirtualizer`. It supplies the scroll wiring (via
 *   `options` / `scrollElement`), and its items/spacers drive the re-pinning.
 * @param deps Optional accessor of extra values that change when content can
 *   grow at the bottom in ways the items/spacers don't capture (e.g. the last
 *   row streaming in taller).
 */
export function createStickToBottom<TRow>(
  snapshot: Accessor<CreateZeroVirtualizerResult<TRow>>,
  options: Accessor<StickOptions> = () => ({}),
  deps: Accessor<ReadonlyArray<unknown>> = () => [],
): void {
  const cache = createStickToBottomCache();
  onCleanup(() => cache.detach());

  createEffect(() => {
    const snapshotValue = snapshot();
    // Reading the store fields tracks the content-growth signals.
    contentGrowthDeps(snapshotValue);
    deps();
    const {enabled = true, slack = DEFAULT_STICK_SLACK} = options();
    if (!enabled) {
      cache.detach();
      return;
    }
    cache.ensure(snapshotValue, slack);
  });
}
