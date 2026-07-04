import {createEffect, createSignal, onCleanup, Show} from 'solid-js';
import {AddControls} from './AddControls.tsx';
import styles from '../shared/DevPanel.module.css';
import type {HeightMode} from './list-shared.ts';

export function DevPanel(props: {
  getScrollElement: () => HTMLElement | null;
  heightMode: HeightMode;
  onHeightModeChange: (v: string) => void;
  sortDirection: 'asc' | 'desc';
  anchoring: string;
  onAnchoringChange: (v: string) => void;
  follow: string;
  onFollowChange: (v: string) => void;
}) {
  const [open, setOpen] = createSignal(true);
  const [st, setSt] = createSignal(0);

  createEffect(() => {
    if (!open()) return;
    const tick = () => {
      const el = props.getScrollElement();
      setSt(el ? Math.round(el.scrollTop) : 0);
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    // Registered inside the effect so closing the panel (effect re-run), not
    // just unmount, stops the loop — otherwise each open/close leaks a chain.
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <Show
      when={open()}
      fallback={
        <button class={styles.launcher} onClick={() => setOpen(true)}>
          <span class={styles.dot} />
          dev panel
          <span class={styles.launcherChevron}>^</span>
        </button>
      }
    >
      <div class={styles.panel}>
        <div class={styles.titleBar}>
          <span class={styles.dot} />
          <span class={styles.titleLabel}>Dev Panel</span>
          <div class={styles.titleSpacer} />
          <button
            class={styles.collapseButton}
            title="Collapse"
            onClick={() => setOpen(false)}
          >
            v
          </button>
        </div>

        <div class={`${styles.section} ${styles.config}`}>
          <label class={styles.fieldLabel}>
            <span class={styles.fieldName}>item sizing</span>
            <select
              class={styles.select}
              value={props.heightMode}
              onChange={e => props.onHeightModeChange(e.currentTarget.value)}
            >
              <option value="fixed">Fixed non-uniform</option>
              <option value="uniform">Fixed uniform</option>
              <option value="dynamic">Dynamic</option>
            </select>
          </label>
          <AddControls sortDirection={props.sortDirection} />
        </div>

        <div class={`${styles.section} ${styles.stats}`}>
          <div class={styles.statRow}>
            <span class={styles.statName}>scrollTop</span>
            <span class={styles.statValue}>{st()}</span>
          </div>
        </div>

        <div class={`${styles.section} ${styles.options}`}>
          <label class={styles.optionRow}>
            <span class={styles.optionName}>anchoring</span>
            <select
              class={styles.optionSelect}
              value={props.anchoring}
              onChange={e => props.onAnchoringChange(e.currentTarget.value)}
            >
              <option value="auto">auto</option>
              <option value="manual">manual</option>
              <option value="native">native</option>
            </select>
          </label>
          <label class={styles.optionRow}>
            <span class={styles.optionName}>follow</span>
            <select
              class={styles.optionSelect}
              value={props.follow}
              onChange={e => props.onFollowChange(e.currentTarget.value)}
            >
              <option value="bottom">bottom (chat)</option>
              <option value="off">none</option>
            </select>
          </label>
        </div>
      </div>
    </Show>
  );
}
