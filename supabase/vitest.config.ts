import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    include: ['scripts/tests/**/*.test.ts'],
    environment: 'node',
    // Each file boots its own PGlite instance and applies every migration.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
