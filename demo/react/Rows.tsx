import {laneAttributes, type VirtualRow} from '@rocicorp/zero-virtual/react';
import React from 'react';
import styles from '../shared/App.module.css';
import {contentWrapperProps} from './list-shared.ts';
import type {Item} from '../shared/schema.ts';

/**
 * The content wrapper and the rows in it, shared by the element and window
 * scroller demos.
 *
 * A list or grid renders its rows between two spacers: `spaceBefore` /
 * `spaceAfter` stand in for the unloaded rows above and below (spanning every
 * column in a grid), so scroll anchoring keeps the viewport stable across
 * paging. Masonry renders one element per lane instead, each with its own
 * cards, and no spacers: the virtualizer pads the lanes itself.
 */
export function Rows({
  wrapperRef,
  lanes,
  masonry,
  items,
  spaceBefore,
  spaceAfter,
  renderRow,
}: {
  wrapperRef?: React.Ref<HTMLDivElement> | undefined;
  lanes: number;
  masonry: boolean;
  items: ReadonlyArray<VirtualRow<Item>>;
  spaceBefore: number;
  spaceAfter: number;
  renderRow: (item: VirtualRow<Item>) => React.ReactNode;
}): React.ReactNode {
  if (masonry) {
    return (
      <div ref={wrapperRef} className={styles.masonry}>
        {Array.from({length: lanes}, (_, lane) => (
          <div key={lane} {...laneAttributes(lane)} className={styles.lane}>
            {items.filter(item => item.lane === lane).map(renderRow)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div ref={wrapperRef} {...contentWrapperProps(lanes)}>
      <div style={{height: spaceBefore, gridColumn: '1 / -1'}} />
      {items.map(renderRow)}
      <div style={{height: spaceAfter, gridColumn: '1 / -1'}} />
    </div>
  );
}
