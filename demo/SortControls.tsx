import styles from './SortControls.module.css';

type Props = {
  sortField: 'created' | 'modified';
  sortDirection: 'asc' | 'desc';
  onToggleSortField: () => void;
  onToggleSortDirection: () => void;
};

export function SortControls({
  sortField,
  sortDirection,
  onToggleSortField,
  onToggleSortDirection,
}: Props) {
  return (
    <div className={styles.sortControls}>
      <button className={styles.sortField} onClick={onToggleSortField}>
        {sortField === 'modified' ? 'Modified' : 'Created'}
      </button>
      <button
        className={`${styles.sortDirection} ${styles[sortDirection]}`}
        onClick={onToggleSortDirection}
        title={sortDirection === 'desc' ? 'Descending' : 'Ascending'}
      >
        <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
          <rect className={styles.sortLine1} x="0" y="0" height="2" rx="1" />
          <rect className={styles.sortLine2} x="0" y="5" height="2" rx="1" />
          <rect className={styles.sortLine3} x="0" y="10" height="2" rx="1" />
        </svg>
      </button>
    </div>
  );
}
