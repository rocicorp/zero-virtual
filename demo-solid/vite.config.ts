import {getRequestListener} from '@hono/node-server';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv, type ViteDevServer} from 'vite';
import solid from 'vite-plugin-solid';

// The Solid demo is a second front end over the React demo's stack: same
// postgres, same zero-cache, same API handlers. Its env therefore lives in
// demo/.env — load it from there so the two demos can't drift apart.
const demoDir = fileURLToPath(new URL('../demo', import.meta.url));

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, demoDir, '');
  Object.assign(process.env, env);

  const apiPlugin = {
    name: 'api-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          return next();
        }
        void getRequestListener(async request => {
          const {app} = await import('../demo/api/index.ts');
          return await app.fetch(request, process.env);
        })(req, res);
      });
    },
  };

  return {
    envDir: demoDir,
    plugins: [solid(), apiPlugin],
    resolve: {
      alias: {
        '@rocicorp/zero-virtual/solid': new URL(
          '../src/solid/index.ts',
          import.meta.url,
        ).pathname,
      },
    },
    // Off the React demo's 5173 so both dev servers can run side by side.
    server: {port: 5273},
  };
});
