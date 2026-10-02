import {useState} from 'react';
import styles from './Chat.module.css';

export function Composer({send}: {send: (body: string) => Promise<void>}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    setError('');
    void send(body).catch(() => {
      setDraft(current => current || body);
      setError('Message could not be sent. Please try again.');
    });
  };

  return (
    <>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <form
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={styles.composerLabel} htmlFor="chat-message">
          Message
        </label>
        <textarea
          id="chat-message"
          placeholder="Write a message…"
          value={draft}
          maxLength={10000}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button disabled={!draft.trim()} aria-label="Send message">
          Send
        </button>
      </form>
      <div className={styles.composerHint}>
        <span>
          <strong>Enter</strong> to send · Shift + Enter for a new line
        </span>
        <span>Message links survive a reload.</span>
      </div>
    </>
  );
}
