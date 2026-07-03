import {useZero} from '@rocicorp/zero/react';
import React, {useCallback} from 'react';
import styles from './DevPanel.module.css';
import {mutators} from './mutators.ts';
import type {Schema} from './schema.ts';

// Timestamps well outside the seeded data range (which sits around "now"), so a
// new item lands at the very start/end of the list regardless of which field
// (`created` / `modified`) is the sort key — we set both to the same value.
const FAR_FUTURE = Date.parse('2100-01-01T00:00:00Z');
const FAR_PAST = Date.parse('1900-01-01T00:00:00Z');

// A human-friendly per-session counter for labels/ids only. Ordering is by the
// timestamp-derived value below, not this, so it survives reloads.
let seq = 0;

/**
 * The dev panel's insert actions: add an item at the start or end of the list.
 * Handy for exercising scroll anchoring under real data mutations: adding above
 * the viewport should keep the visible rows pinned; adding below shouldn't move
 * them.
 */
export function AddControls({
  sortDirection,
}: {
  sortDirection: 'asc' | 'desc';
}): React.ReactNode {
  // We dispatch via the registry form `z.mutate(mutators.item.addAt(...))`, which
  // is callable regardless of the mutators generic, so `useZero<Schema>()` is
  // enough (passing `typeof mutators` here is a MutatorRegistry, not the
  // CustomMutatorDefs the generic expects).
  const z = useZero<Schema>();

  const add = useCallback(
    (position: 'start' | 'end') => {
      // Which extreme sorts to this edge depends on the direction: e.g. `start`
      // is the largest value when descending, the smallest when ascending.
      const wantsMax = (position === 'start') === (sortDirection === 'desc');
      const n = ++seq;
      // Offset the extreme by a monotonic clock so each new item is strictly
      // more extreme than any previous one — even across reloads — and thus
      // always lands at the true edge (not merely ahead of this session's adds).
      const value = wantsMax ? FAR_FUTURE + Date.now() : FAR_PAST - Date.now();
      const result = z.mutate(
        mutators.item.addAt({
          id: `added-${n}-${crypto.randomUUID().slice(0, 8)}`,
          title: `New ${position} item #${n}`,
          description: `Inserted at the ${position} of the list (seq ${n}).`,
          created: value,
          modified: value,
        }),
      );
      void result.client;
      // Surface server-side failures (the optimistic row would silently vanish
      // on rebase otherwise) — and keep the promise observed.
      result.server.catch((e: unknown) => {
        console.error(`addAt(${position}) failed on the server:`, e);
      });
    },
    [sortDirection, z],
  );

  return (
    <div className={styles.actions}>
      <button
        className={styles.actionButton}
        onClick={() => add('start')}
        title="Insert an item at the start of the list"
      >
        + Start
      </button>
      <button
        className={styles.actionButton}
        onClick={() => add('end')}
        title="Insert an item at the end of the list"
      >
        + End
      </button>
    </div>
  );
}
