import {ZeroProvider} from '@rocicorp/zero/react';
import {createRoot} from 'react-dom/client';
import {Demo} from './Demo.tsx';
import '../shared/index.css';
import {mutators} from '../shared/mutators.ts';
import {schema} from '../shared/schema.ts';

const userID = import.meta.env.VITE_PUBLIC_USER_ID ?? 'anon';
const cachePort = import.meta.env.VITE_PUBLIC_CACHE_PORT ?? '5858';
const url = new URL(window.location.href);
const apiBase = `${url.origin}/api/zero`;

createRoot(document.getElementById('root')!).render(
  <ZeroProvider
    schema={schema}
    mutators={mutators}
    userID={userID}
    cacheURL={`${url.protocol}//${url.hostname}:${cachePort}`}
    mutateURL={`${apiBase}/mutate`}
    queryURL={`${apiBase}/query`}
  >
    <Demo />
  </ZeroProvider>,
);
