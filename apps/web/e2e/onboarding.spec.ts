/**
 * Phase 1 end-to-end: log in → create location → add router → test connection
 * → view discovered identity and RouterOS version → confirm audit entries.
 * Also proves the router API password never appears in any network response
 * or in browser storage.
 */
import { expect, test } from '@playwright/test';

const password = process.env['E2E_ADMIN_PASSWORD'];
const email = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@hotzonex.com';

test.skip(!password, 'Set E2E_ADMIN_PASSWORD (the SEED_ADMIN_PASSWORD) and run the stack — see playwright.config.ts.');

test('admin onboards a router end to end, and every step is audited', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const locationName = `E2E Site ${suffix}`;
  const routerName = `E2E Router ${suffix}`;

  // Record every response body so we can prove the router password never comes back from the API.
  const bodies: string[] = [];
  page.on('response', async (res) => {
    try {
      if ((res.headers()['content-type'] ?? '').includes('json')) bodies.push(await res.text());
    } catch {
      // body not available (redirects, aborted requests)
    }
  });

  // 1. Log in.
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // 2. Create a location with GPS coordinates.
  await page.getByRole('link', { name: 'Locations' }).first().click();
  await page.getByRole('button', { name: 'Add location' }).first().click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Name').fill(locationName);
  await panel.getByLabel('Latitude').fill('4.859363');
  await panel.getByLabel('Longitude').fill('31.571250');
  await panel.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByText(locationName)).toBeVisible();

  // 3. Add a router through the wizard.
  await page.getByRole('link', { name: 'Routers' }).first().click();
  await page.getByRole('link', { name: 'Add router' }).first().click();
  await page.getByLabel(/Router name/).fill(routerName);
  await page.getByRole('button', { name: 'Create and continue' }).click();

  // Connect step: credentials are generated, sealed in the browser and stored by the connector.
  await expect(page.getByText('Credentials encrypted and stored by the connector.')).toBeVisible();
  const scriptBox = page.getByLabel('RouterOS setup script');
  let routerPassword: string | null = null;
  if (await scriptBox.isVisible().catch(() => false)) {
    routerPassword = /password="([A-Za-z0-9]+)"/.exec((await scriptBox.textContent()) ?? '')?.[1] ?? null;
  }
  // The connector runs in mock mode, so there is no real WireGuard endpoint; use the simulated key.
  await page.getByRole('button', { name: 'Use a simulated tunnel key' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // 4. Test the connection.
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connected and logged in/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // 5. Discover identity & version.
  await page.getByRole('button', { name: 'Discover now' }).click();
  await expect(page.getByText(/Discovery finished — nothing on the router was changed/)).toBeVisible();
  await expect(page.getByText('RouterOS version').first()).toBeVisible();
  await expect(page.getByText(/^7\.\d+/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Hotspot: pick the first discovered server.
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  // Location.
  await page.getByLabel('Location').selectOption({ label: locationName });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();

  // Router page shows the discovered facts.
  await expect(page.getByRole('heading', { name: routerName })).toBeVisible();
  await page.getByRole('tab', { name: 'System' }).click();
  await expect(page.getByText('RouterOS version')).toBeVisible();

  // 6. Audit entries exist for the whole flow.
  await page.getByRole('tab', { name: 'Audit' }).click();
  for (const label of ['Router added', 'Credentials submitted', 'Credentials stored (encrypted)', 'Connection test requested', 'Connection test passed', 'Sync finished']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await page.goto('/audit?action=auth.');
  await expect(page.getByText('Signed in').first()).toBeVisible();
  await page.goto('/audit?action=location.');
  await expect(page.getByText(locationName).or(page.getByText('Location added')).first()).toBeVisible();

  // 7. Replace the credentials with a password this test knows, and prove it works...
  const knownPassword = `E2eKnown${suffix}Pw9`;
  await page.goto('/routers');
  await page.getByRole('link', { name: routerName }).first().click();
  await page.getByRole('button', { name: 'Replace credentials' }).click();
  await page.getByRole('dialog').getByLabel('API password').fill(knownPassword);
  await page.getByRole('dialog').getByRole('button', { name: 'Encrypt and save' }).click();
  await expect(page.getByText(/Stored\. Run “Test connection”/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connected and logged in/)).toBeVisible();

  // ...then prove neither password came back from any API response or sits in browser storage.
  const storage = await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie, idb: dbs.map((d) => d.name) });
  });
  for (const secret of [knownPassword, routerPassword].filter((s): s is string => Boolean(s))) {
    expect(bodies.join('\n')).not.toContain(secret);
    expect(storage).not.toContain(secret);
  }
});
