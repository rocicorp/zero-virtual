import {useZero} from '@rocicorp/zero/react';
import {useEffect, useState} from 'react';
import {CHAT_MESSAGES} from '../shared/chat-data.ts';
import {mutators} from '../shared/mutators.ts';
import type {Schema} from '../shared/schema.ts';
import styles from './Chat.module.css';

/** Optional demo tools. A real chat only needs the composer. */
export function DemoControls({
  send,
}: {
  send: (body: string, author?: string) => Promise<void>;
}) {
  const z = useZero<Schema>();
  const [live, setLive] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      const body =
        CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)]!;
      void send(body, 'Maya').catch(() => {
        setError('Incoming message failed. Check the demo server.');
        setLive(false);
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [live, send]);

  const seed = async () => {
    setSeeding(true);
    setError('');
    try {
      const result = await z.mutate(mutators.chat.seed({count: 2000})).client;
      if (result.type === 'error') throw new Error(result.error.message);
    } catch {
      setError(
        'Could not seed the conversation. Check the demo server and try again.',
      );
    } finally {
      setSeeding(false);
    }
  };

  return (
    <>
      <button disabled={seeding} onClick={() => void seed()}>
        {seeding ? 'Seeding…' : 'Seed 2,000 messages'}
      </button>
      <label>
        <input
          type="checkbox"
          checked={live}
          onChange={e => setLive(e.target.checked)}
        />{' '}
        Incoming message every 5s
      </label>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </>
  );
}
