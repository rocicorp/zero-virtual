import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql, type Item} from './schema.ts';
import {CHAT_PREFIX, chatQueries} from './chat.ts';

export type ItemStart = Pick<Item, 'id' | 'created' | 'modified'>;

export type ListContextParams = {
  sortField: 'created' | 'modified';
  sortDirection: 'asc' | 'desc';
};

export const queries = defineQueries({
  chat: chatQueries,
  item: {
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
        let q = zql.item
          .where('id', 'NOT LIKE', `${CHAT_PREFIX}%`)
          .limit(limit);

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
        return q;
      },
    ),
  },
});
