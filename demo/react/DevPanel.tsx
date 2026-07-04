import {useEffect, useRef, useState, type ReactNode} from 'react';
import {AddControls} from './AddControls.tsx';
import styles from '../shared/DevPanel.module.css';
import type {HeightMode} from './list-shared.ts';
import {useUrlState} from './use-url-state.ts';

/**
 * The collapsible dev panel from the design handoff: all demo configuration
 * (scroll container, item sizing, add-item actions), the virtualizer's live
 * anchoring stats, and the runtime options, in a dark card pinned bottom-right.
 * Collapses to a pill launcher. Stats poll via rAF; isolated so polling never
 * re-renders the list.
 */
export function DevPanel({
  getScrollElement,
  windowMode = false,
  heightMode,
  onHeightModeChange,
  sortDirection,
  anchoring,
  onAnchoringChange,
  follow,
  onFollowChange,
}: {
  getScrollElement: () => HTMLElement | null;
  windowMode?: boolean;
  heightMode: HeightMode;
  onHeightModeChange: (v: string) => void;
  sortDirection: 'asc' | 'desc';
  anchoring: string;
  onAnchoringChange: (v: string) => void;
  follow: string;
  onFollowChange: (v: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(true);
  // The scroll-container mode lives in the URL (it selects which demo renders).
  const [scroller, setScroller] = useUrlState('scroller', 'element');

  const [snap, setSnap] = useState({st: 0});
  const raf = useRef(0);
  useEffect(() => {
    if (!open) return undefined;
    const tick = () => {
      const el = getScrollElement();
      const st = windowMode
        ? Math.round(window.scrollY)
        : el
          ? Math.round(el.scrollTop)
          : 0;
      setSnap({st});
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [open, getScrollElement, windowMode]);

  if (!open) {
    return (
      <button className={styles.launcher} onClick={() => setOpen(true)}>
        <span className={styles.dot} />
        dev panel
        <span className={styles.launcherChevron}>▴</span>
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.titleBar}>
        <span className={styles.dot} />
        <span className={styles.titleLabel}>Dev Panel</span>
        <div className={styles.titleSpacer} />
        <button
          className={styles.collapseButton}
          title="Collapse"
          onClick={() => setOpen(false)}
        >
          ▾
        </button>
      </div>

      <div className={`${styles.section} ${styles.config}`}>
        <label className={styles.fieldLabel}>
          <span className={styles.fieldName}>container</span>
          <select
            className={styles.select}
            value={scroller}
            onChange={e => setScroller(e.target.value)}
          >
            <option value="window">Window scroll</option>
            <option value="element">Container scroll</option>
          </select>
        </label>
        <label className={styles.fieldLabel}>
          <span className={styles.fieldName}>item sizing</span>
          <select
            className={styles.select}
            value={heightMode}
            onChange={e => onHeightModeChange(e.target.value)}
          >
            <option value="fixed">Fixed non-uniform</option>
            <option value="uniform">Fixed uniform</option>
            <option value="dynamic">Dynamic</option>
          </select>
        </label>
        <AddControls sortDirection={sortDirection} />
      </div>

      <div className={`${styles.section} ${styles.stats}`}>
        <div className={styles.statRow}>
          <span className={styles.statName}>scrollTop</span>
          <span className={styles.statValue}>{snap.st}</span>
        </div>
      </div>

      <div className={`${styles.section} ${styles.options}`}>
        <label className={styles.optionRow}>
          <span className={styles.optionName}>anchoring</span>
          <select
            className={styles.optionSelect}
            value={anchoring}
            onChange={e => onAnchoringChange(e.target.value)}
          >
            <option value="auto">auto</option>
            <option value="manual">manual</option>
            <option value="native">native</option>
          </select>
        </label>
        <label className={styles.optionRow}>
          <span className={styles.optionName}>follow</span>
          <select
            className={styles.optionSelect}
            value={follow}
            onChange={e => onFollowChange(e.target.value)}
          >
            <option value="bottom">bottom (chat)</option>
            <option value="off">none</option>
          </select>
        </label>
      </div>
    </div>
  );
}
