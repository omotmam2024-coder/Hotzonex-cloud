import { defineConfig } from 'vitest/config';

// `pnpm test:live` — talks to a real RouterOS device. Skipped unless MIKROTIK_LIVE=1.
export default defineConfig({
  test: {
    name: 'mikrotik-live',
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 60_000,
  },
});
