import {defineConfig} from 'vitest/config';

export default defineConfig({
  // solid-js ships a non-reactive server build; tests need the browser build
  // (signals/memos/effects actually propagate) — same resolution the demo gets.
  resolve: {
    conditions: ['browser', 'development'],
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Inline solid-js so its own imports (e.g. solid-js/store -> solid-js)
    // also resolve with the conditions above — externalized, the nested
    // import would pick the server build, whose DEV export is undefined.
    server: {deps: {inline: [/solid-js/]}},
  },
});
