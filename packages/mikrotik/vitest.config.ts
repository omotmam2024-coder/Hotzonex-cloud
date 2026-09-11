import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mikrotik',
    include: ['test/**/*.test.ts'],
    exclude: ['test/live/**'],
    environment: 'node',
  },
});
