import {useQuery} from '@rocicorp/zero/solid';
import {Show} from 'solid-js';
import styles from '../demo/ItemDetail.module.css';
import {queries} from '../demo/queries.ts';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'long',
  timeStyle: 'medium',
});

type Props = {
  id: string;
  onClose: () => void;
};

export function ItemDetail(props: Props) {
  const [item, details] = useQuery(() =>
    queries.item.getSingleQuery({id: props.id}),
  );

  return (
    <div class={styles.panel}>
      <button class={styles.close} onClick={props.onClose} aria-label="Close">
        X
      </button>
      <Show
        when={item()}
        fallback={
          <p class={styles.empty}>
            {details().type === 'complete'
              ? `Item not found. ${props.id}`
              : details().type === 'error'
                ? `Error loading item. ${props.id}`
                : 'Loading...'}
          </p>
        }
      >
        {row => (
          <>
            <h2 class={styles.title}>{row().title}</h2>
            <dl class={styles.meta}>
              <dt>ID</dt>
              <dd>{row().id}</dd>
              <dt>Created</dt>
              <dd>{dateFormatter.format(row().created)}</dd>
              <dt>Modified</dt>
              <dd>{dateFormatter.format(row().modified)}</dd>
            </dl>
            <p class={styles.description}>{row().description}</p>
          </>
        )}
      </Show>
    </div>
  );
}
