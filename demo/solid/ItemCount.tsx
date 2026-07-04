import styles from '../shared/App.module.css';

type Props = {
  total: number | undefined;
  estimatedTotal: number;
};

export function ItemCount(props: Props) {
  // Computed per read — Solid components run once, so an early return on
  // props.total would freeze the count at its mount-time value.
  const label = () => {
    if (props.total !== undefined) {
      return `(${props.total})`;
    }
    const roundedEstimate = Number(
      (Math.round(props.estimatedTotal / 50) * 50).toPrecision(2),
    );
    return `(~${roundedEstimate})`;
  };

  return <span class={styles.itemCount}>{label()}</span>;
}
