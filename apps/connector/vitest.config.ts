import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'connector',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
