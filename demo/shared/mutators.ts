import {defineMutator, defineMutators} from '@rocicorp/zero';
import type {Item} from './schema.ts';

export const mutators = defineMutators({
  item: {
    add: defineMutator<Omit<Item, 'modified'>>(async ({tx, args}) => {
      await tx.mutate.item.insert({...args, modified: Date.now()});
    }),

    // Insert with explicit created/modified so the caller can place the item at
    // a chosen sort position (e.g. the very start or end of the list).
    addAt: defineMutator<Item>(async ({tx, args}) => {
      await tx.mutate.item.insert(args);
    }),

    edit: defineMutator<
      Pick<Item, 'id'> & Partial<Pick<Item, 'title' | 'description'>>
    >(async ({tx, args}) => {
      const {id, ...fields} = args;
      await tx.mutate.item.update({id, ...fields, modified: Date.now()});
    }),

    remove: defineMutator<Pick<Item, 'id'>>(async ({tx, args}) => {
      await tx.mutate.item.delete({id: args.id});
    }),
  },
});
