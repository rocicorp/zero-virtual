import type {
  ScrollAlignment,
  ScrollToItemOptions,
} from '@rocicorp/zero-virtual/react';
import React, {useState} from 'react';
import styles from '../shared/DevPanel.module.css';
import {useHash} from './use-hash.ts';

const ALIGNMENTS: ScrollAlignment[] = ['auto', 'start', 'center', 'end'];

/**
 * The dev panel's `scrollToItem` control: jump to a row by id, at a chosen
 * alignment. Ids are opaque (nanoids), so the field falls back to the current
 * URL hash — i.e. the last row clicked — when left empty. Scroll far away from
 * that row first and the jump has to load its page before it can land;
 * scrolling only a little exercises the already-rendered path.
 */
export function JumpControls({
  scrollToItem,
}: {
  scrollToItem: (id: string, options?: ScrollToItemOptions) => void;
}): React.ReactNode {
  const [hash] = useHash();
  const [input, setInput] = useState('');
  const [align, setAlign] = useState<ScrollAlignment>('auto');

  const target = input.trim() || hash;
  const jump = () => {
    if (target) {
      scrollToItem(target, {align});
    }
  };

  return (
    <>
      <label className={styles.fieldLabel}>
        <span className={styles.fieldName}>scrollToItem</span>
        <input
          aria-label="scrollToItem id"
          className={styles.input}
          value={input}
          placeholder={hash || 'item id'}
          spellCheck={false}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              jump();
            }
          }}
        />
      </label>
      <div className={styles.actions}>
        <select
          aria-label="scrollToItem align"
          className={styles.select}
          value={align}
          onChange={e => setAlign(e.target.value as ScrollAlignment)}
          title="Where the row lands in the viewport"
        >
          {ALIGNMENTS.map(a => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          aria-label="Jump"
          className={styles.actionButton}
          onClick={jump}
          disabled={!target}
          title="Scroll the row with this id into view"
        >
          Jump
        </button>
      </div>
    </>
  );
}
