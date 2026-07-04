import styles from '../shared/SortControls.module.css';

type Props = {
  sortField: 'created' | 'modified';
  sortDirection: 'asc' | 'desc';
  onToggleSortField: () => void;
  onToggleSortDirection: () => void;
};

export function SortControls(props: Props) {
  return (
    <div class={styles.sortControls}>
      <button class={styles.sortField} onClick={props.onToggleSortField}>
        {props.sortField === 'modified' ? 'Modified' : 'Created'}
      </button>
      <span class={styles.divider} />
      <button
        class={styles.sortDirection}
        onClick={props.onToggleSortDirection}
        title={props.sortDirection === 'desc' ? 'Descending' : 'Ascending'}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          style={
            props.sortDirection === 'asc' ? 'transform: scaleY(-1);' : undefined
          }
        >
          <line
            x1="3"
            y1="4.5"
            x2="15"
            y2="4.5"
            stroke="#18181b"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <line
            x1="3"
            y1="9"
            x2="11"
            y2="9"
            stroke="#18181b"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <line
            x1="3"
            y1="13.5"
            x2="7"
            y2="13.5"
            stroke="#18181b"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
