import {createEffect, onCleanup, type Accessor} from 'solid-js';
import {elementScrollAdapter} from '../core/scroll-adapter.ts';
import {
  createStickToBottom as createController,
  DEFAULT_STICK_SLACK,
} from '../core/stick-to-bottom.ts';
import type {StickOptions} from './types.ts';

/**
 * Stick-to-bottom for Solid: when content grows, keep the viewport pinned to
 * the bottom — but only if the user was already parked there. Mirror of the
 * React `useStickToBottom`, over the same core controller.
 *
 * Call during component setup (uses `onCleanup`).
 *
 * @param getScrollElement Returns the scroll container — the same element the
 *   virtualizer's `getScrollElement` returns.
 * @param dep An accessor that changes whenever the content can grow at the
 *   bottom (e.g. the snapshot itself, or the newest row's key).
 */
export function createStickToBottom(
  getScrollElement: () => HTMLElement | null,
  dep: Accessor<unknown>,
  options: Accessor<StickOptions> = () => ({}),
): void {
  let controller: ReturnType<typeof createController> | null = null;
  onCleanup(() => controller?.detach());

  createEffect(() => {
    dep();
    const {
      enabled = true,
      slack = DEFAULT_STICK_SLACK,
      adapter = elementScrollAdapter,
    } = options();
    if (!enabled) {
      controller?.detach();
      controller = null;
      return;
    }
    controller ??= createController(getScrollElement, adapter, slack);
    controller.contentChanged();
  });
}
