import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, expect, test} from 'vitest';
import {seededChatMessage} from '../shared/chat-data.ts';
import {useWindowFollow} from './use-window-follow.ts';

afterEach(cleanup);

function position(scrollY: number) {
  Object.defineProperty(document, 'scrollingElement', {
    configurable: true,
    value: document.documentElement,
  });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: 2000,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 500,
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: scrollY,
  });
}

test('counts incoming messages in history, ignores older rows, and clears at bottom', () => {
  position(300);
  const older = seededChatMessage(0);
  const current = seededChatMessage(1);
  const incoming = seededChatMessage(2);
  const {result, rerender} = renderHook(({recent}) => useWindowFollow(recent), {
    initialProps: {recent: [current]},
  });
  expect(result.current).toEqual({atBottom: false, unread: 0});
  rerender({recent: [current, older]});
  expect(result.current.unread).toBe(0);
  rerender({recent: [incoming, current, older]});
  expect(result.current.unread).toBe(1);
  // Metadata updates are not new arrivals.
  rerender({recent: [{...incoming, description: 'edited'}, current, older]});
  expect(result.current.unread).toBe(1);
  act(() => {
    position(1500);
    window.dispatchEvent(new Event('scroll'));
  });
  expect(result.current).toEqual({atBottom: true, unread: 0});
});

test('incoming messages are already read while following latest', () => {
  position(1500);
  const {result, rerender} = renderHook(({recent}) => useWindowFollow(recent), {
    initialProps: {recent: [seededChatMessage(1)]},
  });
  rerender({recent: [seededChatMessage(2), seededChatMessage(1)]});
  expect(result.current).toEqual({atBottom: true, unread: 0});
});
