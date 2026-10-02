import {useQuery, useZero} from '@rocicorp/zero/react';
import {
  useHistoryScrollState,
  useStickToBottom,
  useZeroWindowVirtualizer,
  type GetPageQueryOptions,
  type GetSingleQueryOptions,
} from '@rocicorp/zero-virtual/react';
import {useCallback, useEffect, useRef} from 'react';
import {mutators} from '../shared/mutators.ts';
import {queries} from '../shared/queries.ts';
import type {ChatMessage, ChatStart} from '../shared/chat.ts';
import type {Schema} from '../shared/schema.ts';
import {useHash} from '../shared/react/use-hash.ts';
import {useWindowFollow} from './use-window-follow.ts';

const getRowKey = (row: ChatMessage) => row.id;
const toStartRow = (row: ChatMessage): ChatStart => ({
  id: row.id,
  created: row.created,
});

const context = {conversation: 'studio'};
const estimateSize = () => 110;
const getPageQuery = ({limit, start, dir}: GetPageQueryOptions<ChatStart>) => ({
  query: queries.chat.page({limit, start, dir}),
});
const getSingleQuery = ({id}: GetSingleQueryOptions) => ({
  query: queries.chat.single({id}),
});
/** The Zero queries, virtualizer, and send action for one conversation. */
export function useChat() {
  const z = useZero<Schema>();
  const [hash] = useHash();
  const [latest, latestResult] = useQuery(queries.chat.latest());
  const [recent] = useQuery(queries.chat.recent());
  const [scrollState, onScrollStateChange] =
    useHistoryScrollState<ChatStart>('chatWindowScroll');
  const rowsRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => rowsRef.current, []);
  const started = useRef(false);
  const virtualizer = useZeroWindowVirtualizer({
    listContextParams: context,
    getScrollElement,
    estimateSize,
    minPageSize: 20,
    getPageQuery,
    getSingleQuery,
    getRowKey,
    toStartRow,
    permalinkID: hash || null,
    scrollState,
    onScrollStateChange,
  });
  useStickToBottom(virtualizer);
  const {atBottom, unread} = useWindowFollow(recent);

  useEffect(() => {
    if (started.current || !latest) return;
    started.current = true;
    if (!hash && !scrollState)
      virtualizer.scrollToItem(latest.id, {align: 'end'});
  }, [latest, hash, scrollState, virtualizer]);

  const send = useCallback(
    async (body: string, author = 'You') => {
      // Only wait for the local optimistic write. Zero reconciles with the server.
      const result = await z.mutate(
        mutators.chat.send({
          id: `chat-live-${crypto.randomUUID()}`,
          author,
          body,
          created: Math.max(Date.now(), (latest?.created ?? 0) + 1),
        }),
      ).client;
      if (result.type === 'error') throw new Error(result.error.message);
    },
    [z, latest?.created],
  );

  const jumpToLatest = () => {
    if (latest) virtualizer.scrollToItem(latest.id, {align: 'end'});
  };

  return {
    virtualizer,
    rowsRef,
    permalinkID: hash,
    loading: latestResult.type !== 'complete',
    empty: !latest,
    atBottom,
    unread,
    jumpToLatest,
    send,
  };
}
