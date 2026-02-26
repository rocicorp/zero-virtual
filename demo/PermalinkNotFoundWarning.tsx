import {useEffect, useState} from 'react';
import styles from './PermalinkNotFoundWarning.module.css';

type Props = {
  show: boolean;
  permalinkID: string | null;
};

export function PermalinkNotFoundWarning({show, permalinkID}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) {
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [show, permalinkID]);

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.banner} role="alert">
      <span className={styles.message}>
        Item <span className={styles.id}>{permalinkID}</span> was not found.
      </span>
      <button
        className={styles.close}
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
