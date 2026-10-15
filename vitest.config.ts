import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Sets up the `@/` alias, `import.meta.env.*` and an in-memory `browser` API.
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // Dexie needs IndexedDB, which Node doesn't have.
    setupFiles: ['fake-indexeddb/auto'],
  },
});
