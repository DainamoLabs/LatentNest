import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Chromium lives in the project (`npm run test:e2e:install`), not ~/.cache.
// Set here so the test workers, started after the config loads, inherit it.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('.playwright', import.meta.url));

export default defineConfig({
  testDir: 'tests/e2e',
  // One browser profile per test; the extension's batch runner is global to it.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
});
