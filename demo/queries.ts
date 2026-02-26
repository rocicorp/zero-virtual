import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql} from './schema.ts';

export const queries = defineQueries({
  item: {
    all: defineQuery(() => zql.item.orderBy('modified', 'desc')),
  },
});
