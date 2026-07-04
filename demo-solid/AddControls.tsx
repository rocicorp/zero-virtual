import {useZero} from '@rocicorp/zero/solid';
import styles from '../demo/DevPanel.module.css';
import {mutators} from '../demo/mutators.ts';
import type {Schema} from '../demo/schema.ts';

const FAR_FUTURE = Date.parse('2100-01-01T00:00:00Z');
const FAR_PAST = Date.parse('1900-01-01T00:00:00Z');

let seq = 0;

export function AddControls(props: {sortDirection: 'asc' | 'desc'}) {
  const z = useZero<Schema>();

  const add = (position: 'start' | 'end') => {
    const wantsMax =
      (position === 'start') === (props.sortDirection === 'desc');
    const n = ++seq;
    const value = wantsMax ? FAR_FUTURE + Date.now() : FAR_PAST - Date.now();
    const result = z().mutate(
      mutators.item.addAt({
        id: `added-${n}-${crypto.randomUUID().slice(0, 8)}`,
        title: `New ${position} item #${n}`,
        description: `Inserted at the ${position} of the list (seq ${n}).`,
        created: value,
        modified: value,
      }),
    );
    void result.client;
    result.server.catch((e: unknown) => {
      console.error(`addAt(${position}) failed on the server:`, e);
    });
  };

  return (
    <div class={styles.actions}>
      <button
        class={styles.actionButton}
        onClick={() => add('start')}
        title="Insert an item at the start of the list"
      >
        + Start
      </button>
      <button
        class={styles.actionButton}
        onClick={() => add('end')}
        title="Insert an item at the end of the list"
      >
        + End
      </button>
    </div>
  );
}
