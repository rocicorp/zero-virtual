import {getRequestListener} from '@hono/node-server';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv, type ViteDevServer} from 'vite';
import {assert} from '../src/asserts.ts';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  assert(
    env.VITE_PUBLIC_ZERO_CACHE_URL,
    'VITE_PUBLIC_ZERO_CACHE_URL environment variable is required',
  );

  const apiPlugin = {
    name: 'api-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          return next();
        }
        getRequestListener(async request => {
          const {app} = await import('./api/index.ts');
          return await app.fetch(request, process.env);
        })(req, res);
      });
    },
  };

  return {
    plugins: [react(), apiPlugin],
    resolve: {
      alias: {
        '@rocicorp/zero-virtual/react': new URL(
          '../src/react/index.ts',
          import.meta.url,
        ).pathname,
      },
    },
  };
});
