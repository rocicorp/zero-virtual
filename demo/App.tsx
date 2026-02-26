import {useQuery} from '@rocicorp/zero/react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {useRef} from 'react';
import {queries} from './queries.ts';

const ITEM_HEIGHT = 48;

export function App() {
  const [items] = useQuery(queries.item.all());

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
    getItemKey: index => items[index].id,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>TanStack Virtual Demo</h1>
      {/* Scrollable viewport */}
      <div ref={parentRef} style={styles.viewport}>
        {/* Total height spacer */}
        <div style={{height: virtualizer.getTotalSize(), position: 'relative'}}>
          {virtualItems.map(virtualRow => {
            const item = items[virtualRow.index];
            const isEven = virtualRow.index % 2 === 0;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  ...styles.row,
                  background: isEven ? '#f8f9fa' : '#ffffff',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span style={styles.rowLabel}>{item.title}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 640,
    margin: '32px auto',
    padding: '0 16px',
  },
  heading: {
    fontSize: 24,
    fontWeight: 700,
    margin: '0 0 4px',
  },
  subtitle: {
    color: '#555',
    margin: '0 0 16px',
    fontSize: 14,
  },
  viewport: {
    height: 500,
    overflow: 'auto',
    border: '1px solid #ddd',
    borderRadius: 8,
    background: '#fff',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    height: ITEM_HEIGHT,
    padding: '0 16px',
    gap: 16,
    borderBottom: '1px solid #eee',
    boxSizing: 'border-box' as const,
  },
  rowIndex: {
    color: '#999',
    fontSize: 12,
    width: 48,
    flexShrink: 0,
    textAlign: 'right' as const,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: 500,
  },
  rowValue: {
    fontSize: 13,
    color: '#444',
    fontVariantNumeric: 'tabular-nums',
  },
  footer: {
    marginTop: 12,
    fontSize: 13,
    color: '#555',
  },
} as const;
