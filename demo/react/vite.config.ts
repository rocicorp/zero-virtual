import {getRequestListener} from '@hono/node-server';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv, type ViteDevServer} from 'vite';

// The stack (postgres, zero-cache, API handlers, .env) is shared with the
// Solid demo and lives in demo/shared.
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, sharedDir, '');
  Object.assign(process.env, env);

  const apiPlugin = {
    name: 'api-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          return next();
        }
        void getRequestListener(async request => {
          const {app} = await import('../shared/api/index.ts');
          return await app.fetch(request, process.env);
        })(req, res);
      });
    },
  };

  return {
    envDir: sharedDir,
    plugins: [apiPlugin],
    resolve: {
      alias: {
        '@rocicorp/zero-virtual/react': new URL(
          '../../src/react/index.ts',
          import.meta.url,
        ).pathname,
      },
    },
  };
});
