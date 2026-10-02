import {rowAttributes, type VirtualRow} from '@rocicorp/zero-virtual/react';
import type {ReactNode} from 'react';
import type {ChatMessage} from '../shared/chat.ts';
import styles from './Chat.module.css';

const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

export function Message({
  item,
  permalinkID,
}: {
  item: VirtualRow<ChatMessage>;
  permalinkID: string;
}): ReactNode {
  const {row, index, key} = item;
  return (
    <article
      {...rowAttributes(index, key)}
      className={`${styles.message} ${key === permalinkID ? styles.highlighted : ''}`}
    >
      <div className={styles.messageBody}>
        <div className={styles.byline}>
          <strong>{row?.title ?? 'Loading…'}</strong>
          {row && (
            <>
              <time dateTime={new Date(row.created).toISOString()}>
                {time.format(row.created)}
              </time>
              <a
                href={`#${row.id}`}
                aria-label={`Link to message from ${row.title}`}
              >
                link
              </a>
            </>
          )}
        </div>
        <p>{row?.description ?? 'Loading message…'}</p>
        {row?.description.includes('attached') && (
          <details className={styles.attachment}>
            <summary>notes.txt</summary>
            <div>
              <strong>Scroll behavior</strong>
              <p>
                Load older messages above the viewport without moving the
                message you’re reading.
              </p>
              <p>
                Expand or collapse this attachment to change the row height. The
                visible messages should keep their position.
              </p>
              <p>
                At the end of the conversation, new messages follow
                automatically. Scroll away to catch up at your own pace.
              </p>
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
