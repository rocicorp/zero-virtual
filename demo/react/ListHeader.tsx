import React from 'react';
import styles from '../shared/App.module.css';
import {ItemCount} from './ItemCount.tsx';
import {SortControls} from './SortControls.tsx';

type Props = {
  total: number | undefined;
  estimatedTotal: number;
  sortField: 'created' | 'modified';
  sortDirection: 'asc' | 'desc';
  onToggleSortField: () => void;
  onToggleSortDirection: () => void;
};

/** The demo header, shared by the element and window scroller demos: title,
 * live item count, and the sort control. All other demo configuration lives in
 * the {@link DevPanel}. */
export function ListHeader({
  total,
  estimatedTotal,
  sortField,
  sortDirection,
  onToggleSortField,
  onToggleSortDirection,
}: Props): React.ReactNode {
  return (
    <div className={styles.header}>
      <h1 className={styles.heading}>Zero Virtual Demo</h1>
      <ItemCount total={total} estimatedTotal={estimatedTotal} />
      <div className={styles.headerSpacer} />
      <SortControls
        sortField={sortField}
        sortDirection={sortDirection}
        onToggleSortField={onToggleSortField}
        onToggleSortDirection={onToggleSortDirection}
      />
    </div>
  );
}
