import {useQuery} from '@rocicorp/zero/react';
import React from 'react';
import styles from './ItemDetail.module.css';
import {queries} from './queries.ts';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'long',
  timeStyle: 'medium',
});

type Props = {
  id: string;
  onClose: () => void;
};

export function ItemDetail({id, onClose}: Props) {
  const [item, {type}] = useQuery(queries.item.getSingleQuery({id}));

  let content: React.ReactNode;

  if (!item) {
    switch (type) {
      case 'complete':
        content = <p className={styles.empty}>Item not found. {id}</p>;
        break;
      case 'error':
        content = <p className={styles.empty}>Error loading item. {id}</p>;
        break;
      default:
        content = <p className={styles.empty}>Loading…</p>;
    }
  } else {
    content = (
      <>
        <h2 className={styles.title}>{item.title}</h2>
        <dl className={styles.meta}>
          <dt>ID</dt>
          <dd>{item.id}</dd>
          <dt>Created</dt>
          <dd>{dateFormatter.format(item.created)}</dd>
          <dt>Modified</dt>
          <dd>{dateFormatter.format(item.modified)}</dd>
        </dl>
        <p className={styles.description}>{item.description}</p>
      </>
    );
  }

  return (
    <div className={styles.panel}>
      <button className={styles.close} onClick={onClose} aria-label="Close">
        ✕
      </button>
      {content}
    </div>
  );
}
