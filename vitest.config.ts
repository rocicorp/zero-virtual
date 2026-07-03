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
  },
});
