import React from 'react';
import styles from '../shared/SortControls.module.css';

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
}: Props): React.ReactNode {
  return (
    <div className={styles.sortControls}>
      <button className={styles.sortField} onClick={onToggleSortField}>
        {sortField === 'modified' ? 'Modified' : 'Created'}
      </button>
      <span className={styles.divider} />
      <button
        className={styles.sortDirection}
        onClick={onToggleSortDirection}
        title={sortDirection === 'desc' ? 'Descending' : 'Ascending'}
      >
        {/* Descending glyph (lines of decreasing length); flipped for asc. */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          style={{
            transform: sortDirection === 'asc' ? 'scaleY(-1)' : undefined,
          }}
        >
          <line
            x1="3"
            y1="4.5"
            x2="15"
            y2="4.5"
            stroke="#18181b"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <line
            x1="3"
            y1="9"
            x2="11"
            y2="9"
            stroke="#18181b"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <line
            x1="3"
            y1="13.5"
            x2="7"
            y2="13.5"
            stroke="#18181b"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
