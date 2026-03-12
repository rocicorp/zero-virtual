import {getRequestListener} from '@hono/node-server';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv, type ViteDevServer} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  const apiPlugin = {
    name: 'api-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          return next();
        }
        void getRequestListener(async request => {
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
