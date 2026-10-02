import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {ChatMessage} from '../shared/chat.ts';

/** Toolbar state only; useStickToBottom owns the actual scrolling. */
export function useWindowFollow(recent: readonly ChatMessage[]) {
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [unread, setUnread] = useState(0);
  const previousRecent = useRef<{ids: Set<string>; newestTime: number} | null>(
    null,
  );
  const measurePosition = useCallback(() => {
    const el = document.scrollingElement;
    if (!el) return;
    const bottom = el.scrollHeight - window.scrollY - window.innerHeight <= 4;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnread(0);
  }, []);
  // Loading or restoring history can change the gap without a scroll event.
  useLayoutEffect(() => measurePosition());

  useEffect(() => {
    window.addEventListener('scroll', measurePosition, {passive: true});
    window.addEventListener('resize', measurePosition);
    return () => {
      window.removeEventListener('scroll', measurePosition);
      window.removeEventListener('resize', measurePosition);
    };
  }, [measurePosition]);

  useEffect(() => {
    const previous = previousRecent.current;
    if (previous && !atBottomRef.current) {
      setUnread(
        n =>
          n +
          recent.filter(
            row =>
              !previous.ids.has(row.id) && row.created >= previous.newestTime,
          ).length,
      );
    }
    if (recent.length)
      previousRecent.current = {
        ids: new Set(recent.map(row => row.id)),
        newestTime: recent[0]!.created,
      };
  }, [recent]);

  return {atBottom, unread};
}
