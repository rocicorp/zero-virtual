import {cleanup, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {useChat} from './use-chat.ts';

const {mutate} = vi.hoisted(() => ({mutate: vi.fn()}));

vi.mock('@rocicorp/zero/react', () => ({
  useZero: () => ({mutate}),
  useQuery: () => [undefined, {type: 'complete'}],
}));
vi.mock('@rocicorp/zero-virtual/react', () => ({
  useHistoryScrollState: () => [null, vi.fn()],
  useStickToBottom: () => {},
  useZeroWindowVirtualizer: () => ({}),
}));
vi.mock('../shared/react/use-hash.ts', () => ({useHash: () => ['']}));
vi.mock('./use-window-follow.ts', () => ({
  useWindowFollow: () => ({atBottom: true, unread: 0}),
}));

const success = {type: 'success'} as const;
const failure = {
  type: 'error',
  error: {type: 'app', message: 'Local write failed'},
} as const;

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

test('sending completes while server acknowledgement is still pending', async () => {
  mutate.mockReturnValue({
    client: Promise.resolve(success),
    server: new Promise(() => {}),
  });
  const {result} = renderHook(useChat);
  await expect(result.current.send('Hello')).resolves.toBeUndefined();
});

test('server failure does not turn a successful local send into a failed draft', async () => {
  mutate.mockReturnValue({
    client: Promise.resolve(success),
    server: Promise.resolve(failure),
  });
  const {result} = renderHook(useChat);
  await expect(result.current.send('Hello')).resolves.toBeUndefined();
});

test('local failure is reported to the composer', async () => {
  mutate.mockReturnValue({
    client: Promise.resolve(failure),
    server: new Promise(() => {}),
  });
  const {result} = renderHook(useChat);
  await expect(result.current.send('Hello')).rejects.toThrow(
    'Local write failed',
  );
});
