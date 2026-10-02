import {ZeroProvider} from '@rocicorp/zero/react';
import {createRoot} from 'react-dom/client';
import {Chat} from './Chat.tsx';
import '../shared/index.css';
import {mutators} from '../shared/mutators.ts';
import {schema} from '../shared/schema.ts';

const userID = import.meta.env.VITE_PUBLIC_USER_ID ?? 'anon';
const cachePort = import.meta.env.VITE_PUBLIC_CACHE_PORT ?? '5858';
const url = new URL(window.location.href);
// The shared dev backend allows localhost callback URLs. Keep those callbacks
// canonical when the preview itself is opened through the loopback IP.
const apiURL = new URL(url);
if (import.meta.env.DEV && apiURL.hostname === '127.0.0.1') {
  apiURL.hostname = 'localhost';
}
const apiBase = `${apiURL.origin}/api/zero`;

createRoot(document.getElementById('root')!).render(
  <ZeroProvider
    schema={schema}
    mutators={mutators}
    userID={userID}
    cacheURL={`${url.protocol}//${url.hostname}:${cachePort}`}
    mutateURL={`${apiBase}/mutate`}
    queryURL={`${apiBase}/query`}
  >
    <Chat />
  </ZeroProvider>,
);
