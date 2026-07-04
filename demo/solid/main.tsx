import {ZeroProvider} from '@rocicorp/zero/solid';
import {render} from 'solid-js/web';
import {mutators} from '../shared/mutators.ts';
import {schema} from '../shared/schema.ts';
import {App} from './App.tsx';
import '../shared/index.css';

const userID = import.meta.env.VITE_PUBLIC_USER_ID ?? 'anon';
const cachePort = import.meta.env.VITE_PUBLIC_CACHE_PORT ?? '5858';
const url = new URL(window.location.href);
const apiBase = `${url.origin}/api/zero`;

render(
  () => (
    <ZeroProvider
      schema={schema}
      mutators={mutators}
      userID={userID}
      cacheURL={`${url.protocol}//${url.hostname}:${cachePort}`}
      mutateURL={`${apiBase}/mutate`}
      queryURL={`${apiBase}/query`}
    >
      <App />
    </ZeroProvider>
  ),
  document.getElementById('root')!,
);
