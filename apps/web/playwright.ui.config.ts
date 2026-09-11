import { defineConfig, devices } from '@playwright/test';

/**
 * UI-only suite: the real web app against an intercepted, in-test Supabase
 * double (e2e-ui/mock-backend.ts). Verifies rendering, layout at 360px and
 * desktop, and client behaviour. It does NOT prove the backend works — see
 * playwright.config.ts for the end-to-end suite that needs a real stack.
 */
export default defineConfig({
  testDir: 'e2e-ui',
  outputDir: 'test-results/ui',
  fullyParallel: true,
  reporter: [['list']],
  // Service workers would sit between the page and Playwright's request interception.
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'mobile-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 760 } } },
  ],
  webServer: {
    // The production bundle, not the dev server: what ships, and no cold-compile delays.
    command: 'pnpm exec vite build --outDir dist-ui --emptyOutDir && pnpm exec vite preview --outDir dist-ui --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: 'https://mock-supabase.test', VITE_SUPABASE_ANON_KEY: 'mock-anon-key-for-ui-tests-only-000000' },
  },
});
