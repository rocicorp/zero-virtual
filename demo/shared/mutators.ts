import {defineMutator, defineMutators} from '@rocicorp/zero';
import {seededChatMessage} from './chat-data.ts';
import {chatMutators} from './chat.ts';
import type {Item} from './schema.ts';

export const mutators = defineMutators({
  chat: {
    ...chatMutators,
    seed: defineMutator<{count: number}>(async ({tx, args}) => {
      const count = Math.max(0, Math.min(2000, Math.floor(args.count)));
      for (let i = 0; i < count; i++)
        await tx.mutate.item.upsert(seededChatMessage(i));
    }),
  },
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
