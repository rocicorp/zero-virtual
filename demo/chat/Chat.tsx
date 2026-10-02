import {Composer} from './Composer.tsx';
import {DemoControls} from './DemoControls.tsx';
import {Message} from './Message.tsx';
import {useChat} from './use-chat.ts';
import {useWindowInsets} from './use-window-insets.ts';
import styles from './Chat.module.css';

export function Chat() {
  const chat = useChat();
  const {headerRef, footerRef} = useWindowInsets();
  const {items, spaceBefore, spaceAfter} = chat.virtualizer;

  return (
    <main className={styles.page}>
      <section className={styles.conversation} aria-label="Chat demo">
        <div ref={headerRef} className={styles.stickyHeader}>
          <header className={styles.header}>
            <h1>
              Chat demo <code>zero-virtual</code>
            </h1>
            <p>
              Variable-height messages, live updates, and scroll restoration.
            </p>
          </header>
          <div className={styles.controls}>
            <DemoControls send={chat.send} />
            <button
              disabled={chat.atBottom || chat.empty}
              onClick={chat.jumpToLatest}
            >
              Jump to latest{chat.unread ? ` (${chat.unread} new)` : ''}
            </button>
          </div>
          <div className={styles.status}>
            <span>
              Window scroll · {items.filter(item => item.row).length} rows
              rendered
            </span>
            <span>
              {chat.atBottom ? 'Following latest' : 'Reading history'}
            </span>
          </div>
        </div>
        <div ref={chat.rowsRef} className={styles.messageList}>
          <div className={styles.messages}>
            <div style={{height: spaceBefore}} />
            {items.map(item => (
              <Message
                key={item.key}
                item={item}
                permalinkID={chat.permalinkID}
              />
            ))}
            <div style={{height: spaceAfter}} />
          </div>
          {chat.empty && (
            <div className={styles.empty}>
              <p>
                {chat.loading
                  ? 'Connecting…'
                  : 'No messages. Seed the demo or send one.'}
              </p>
            </div>
          )}
        </div>
        <div className={styles.composerSpace} aria-hidden="true" />
        <footer ref={footerRef} className={styles.footer}>
          <Composer send={chat.send} />
        </footer>
      </section>
    </main>
  );
}
