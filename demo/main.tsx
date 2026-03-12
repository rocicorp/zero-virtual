import {ZeroProvider} from '@rocicorp/zero/react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.tsx';
import './index.css';
import {schema} from './schema.ts';

const userID = import.meta.env.VITE_PUBLIC_USER_ID ?? 'anon';
const url = new URL(window.location.href);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ZeroProvider
      schema={schema}
      userID={userID}
      cacheURL={`${url.protocol}//${url.hostname}:4848`}
      queryURL={url.origin + '/api/zero/query'}
      mutateURL={url.origin + '/api/zero/mutate'}
    >
      <App />
    </ZeroProvider>
  </StrictMode>,
);
