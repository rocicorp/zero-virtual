import {defineConfig} from '@playwright/test';

// Environment variables are loaded via `node --env-file=.env` in the
// test:e2e script, so no manual .env parsing is needed here.
export default defineConfig({
  testDir: './e2e/tests',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? {workers: 1} : {}),
  // Give CI more time — zero-cache cold-start and replication are slower there.
  timeout: process.env.CI ? 60_000 : 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  // Vite dev server — started after globalSetup, stopped after globalTeardown.
  webServer: {
    command: 'pnpm dev:ui',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
