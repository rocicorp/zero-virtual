import styles from './App.module.css';

type Props = {
  total: number | undefined;
  estimatedTotal: number;
};

export function ItemCount({total, estimatedTotal}: Props) {
  if (total !== undefined) {
    return <span className={styles.itemCount}>({total})</span>;
  }

  const roundedEstimate = Number(
    (Math.round(estimatedTotal / 50) * 50).toPrecision(2),
  );

  return <span className={styles.itemCount}>(~{roundedEstimate})</span>;
}
