import type {Item} from './schema.ts';

import {CHAT_PREFIX} from './chat.ts';
export const CHAT_AUTHORS = ['Maya', 'Theo', 'Sam', 'Jules'];
export const CHAT_MESSAGES = [
  'Morning! How is the new chat demo coming along?',
  'Just tried scrolling through the history. It feels really smooth.',
  'The interesting part is keeping your place when older messages load above you. Especially when the messages have different heights.',
  'I attached some notes about the interaction. Expand them and see whether the conversation stays anchored.',
  'Looks good to me. Let’s try it with a few thousand messages next.',
  'One more thing: links should take you straight to the message, even when it is outside the loaded page.',
  'Coffee break ☕',
  'New messages should follow along when you’re at the bottom. If you’re reading history, they should wait for you.',
];

/** Stable IDs make seeding safe to repeat, including from another tab. */
export function seededChatMessage(index: number): Item {
  const created = Date.UTC(2026, 8, 1, 9) + index * 60_000;
  return {
    id: `${CHAT_PREFIX}seed-${String(index).padStart(5, '0')}`,
    title: CHAT_AUTHORS[index % CHAT_AUTHORS.length]!,
    description: CHAT_MESSAGES[index % CHAT_MESSAGES.length]!,
    created,
    modified: created,
  };
}
