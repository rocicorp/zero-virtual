import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  // solid-js ships a non-reactive server build; tests need the browser build
  // (signals/memos/effects actually propagate) — same resolution the demo gets.
  resolve: {
    conditions: ['browser', 'development'],
    // Demo tests import the package by name; CI runs tests before building dist.
    alias: {
      '@rocicorp/zero-virtual/react': fileURLToPath(
        new URL('./src/react/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'demo/chat/**/*.test.{ts,tsx}'],
    // Inline solid-js so its own imports (e.g. solid-js/store -> solid-js)
    // also resolve with the conditions above — externalized, the nested
    // import would pick the server build, whose DEV export is undefined.
    server: {deps: {inline: [/solid-js/]}},
  },
});
