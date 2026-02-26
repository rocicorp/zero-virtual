import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql, type Item} from './schema.ts';

export type ItemStart = Pick<Item, 'created' | 'modified'>;

export const queries = defineQueries({
  item: {
    all: defineQuery(() => zql.item.orderBy('modified', 'desc')),

    getSingleQuery: defineQuery(({args: {id}}: {args: {id: string}}) =>
      zql.item.where('id', id).one(),
    ),

    getPageQuery: defineQuery(
      ({
        args: {limit, start, dir, sortField},
      }: {
        args: {
          limit: number;
          start: ItemStart | null;
          dir: 'forward' | 'backward';
          sortField: 'created' | 'modified';
        };
      }) => {
        let q = zql.item
          .orderBy(sortField, dir === 'forward' ? 'desc' : 'asc')
          .limit(limit);
        if (start) {
          q = q.start(start);
        }
        return q;
      },
    ),
  },
});
