import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the real web app, the real Supabase stack (Auth, PostgREST,
 * Realtime, RLS) and the real connector (MIKROTIK_PROVIDER=mock — no physical
 * router). Prerequisites (docs/RUNBOOK.md → "Running the E2E suite"):
 *
 *   pnpm db:migrate && pnpm db:seed         # local Supabase, admin@hotzonex.com
 *   pnpm --filter @hotzonex/connector dev    # connector in mock mode
 *   E2E_ADMIN_PASSWORD=<SEED_ADMIN_PASSWORD> pnpm test:e2e
 *
 * The web app is started here with apps/web/.env.local (real Supabase URL/key).
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
