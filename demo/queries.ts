import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql, type Item} from './schema.ts';

export type ItemStart = Pick<Item, 'created' | 'modified'>;

export type ListContextParams = {
  sortField: 'created' | 'modified';
  sortDirection: 'asc' | 'desc';
};

export const queries = defineQueries({
  item: {
    all: defineQuery(() => zql.item.orderBy('modified', 'desc')),

    getSingleQuery: defineQuery(({args: {id}}: {args: {id: string}}) =>
      zql.item.where('id', id).one(),
    ),

    getPageQuery: defineQuery(
      ({
        args: {limit, start, dir, listContextParams},
      }: {
        args: {
          limit: number;
          start: ItemStart | null;
          dir: 'forward' | 'backward';
          listContextParams: ListContextParams;
        };
      }) => {
        let q = zql.item.limit(limit);

        const {sortField, sortDirection} = listContextParams;
        const orderByDir =
          dir === 'forward'
            ? sortDirection
            : sortDirection === 'asc'
              ? 'desc'
              : 'asc';
        q = q.orderBy(sortField, orderByDir).orderBy('id', orderByDir);

        if (start) {
          q = q.start(start, {inclusive: false});
        }
        console.log('getPageQuery', {
          start,
          dir,
          sortField,
          sortDirection,
          effectiveDirection: effectiveDirection(dir, sortDirection),
        });
        return q;
      },
    ),
  },
});

function effectiveDirection(
  dir: 'forward' | 'backward',
  sortDirection: 'asc' | 'desc',
): 'asc' | 'desc' {
  return dir === 'forward'
    ? sortDirection
    : sortDirection === 'asc'
      ? 'desc'
      : 'asc';
}
