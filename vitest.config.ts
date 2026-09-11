import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/mikrotik', 'packages/shared', 'supabase', 'apps/connector'],
  },
});
