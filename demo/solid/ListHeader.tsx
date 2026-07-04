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

export function ListHeader(props: Props) {
  return (
    <div class={styles.header}>
      <h1 class={styles.heading}>Zero Virtual Demo (Solid)</h1>
      <ItemCount total={props.total} estimatedTotal={props.estimatedTotal} />
      <div class={styles.headerSpacer} />
      <SortControls
        sortField={props.sortField}
        sortDirection={props.sortDirection}
        onToggleSortField={props.onToggleSortField}
        onToggleSortDirection={props.onToggleSortDirection}
      />
    </div>
  );
}
