import {defineMutator, defineQuery} from '@rocicorp/zero';
import {zql, type Item} from './schema.ts';

// This demo reuses the list demo's table: title = author, description = body.
// In your app, use a message table and filter by conversationID instead.
export const CHAT_PREFIX = 'chat-';
export type ChatMessage = Item;
export type ChatStart = Pick<ChatMessage, 'id' | 'created'>;

const messages = () => zql.item.where('id', 'LIKE', `${CHAT_PREFIX}%`);
const orderedMessages = (direction: 'asc' | 'desc') =>
  messages().orderBy('created', direction).orderBy('id', direction);

export const chatQueries = {
  latest: defineQuery(() => orderedMessages('desc').one()),
  recent: defineQuery(() => orderedMessages('desc').limit(100)),
  single: defineQuery(({args: {id}}: {args: {id: string}}) =>
    messages().where('id', id).one(),
  ),
  page: defineQuery(
    ({
      args: {limit, start, dir},
    }: {
      args: {
        limit: number;
        start: ChatStart | null;
        dir: 'forward' | 'backward';
      };
    }) => {
      let q = orderedMessages(dir === 'forward' ? 'asc' : 'desc').limit(limit);
      if (start) q = q.start(start, {inclusive: false});
      return q;
    },
  ),
};

export const chatMutators = {
  send: defineMutator<{
    id: string;
    author: string;
    body: string;
    created: number;
  }>(async ({tx, args}) => {
    const body = args.body.trim();
    if (!body || body.length > 10000)
      throw new Error('Message must contain 1–10,000 characters.');
    await tx.mutate.item.insert({
      id: args.id,
      title: args.author,
      description: body,
      created: args.created,
      modified: args.created,
    });
  }),
};
