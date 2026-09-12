import { expect, test, type Page } from '@playwright/test';
import { installMockBackend } from './mock-backend';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@hotzonex.com');
  await page.getByLabel('Password').fill('CorrectPassword1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-results/ui/screens/${test.info().project.name}-${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await installMockBackend(page);
});

test('login rejects a wrong password with a plain sentence', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('MikroTik Hotspot Management & WiFi Platform')).toBeVisible();
  await page.getByLabel('Email').fill('admin@hotzonex.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await expectNoHorizontalScroll(page);
  await shot(page, 'login');
});

test('dashboard: real counts exclude demo routers; problems first; uptime bars', async ({ page }) => {
  await signIn(page);
  const tiles = page.locator('section').filter({ hasText: /^Routers/ }).first();
  await expect(tiles).toContainText('5');
  await expect(page.getByText('+1 demo, not counted')).toBeVisible();
  await expect(page.locator('section').filter({ hasText: /^Online/ }).first()).toContainText('2');
  await expect(page.locator('section').filter({ hasText: /^Offline/ }).first()).toContainText('1');
  // Table on desktop, cards on phones: check whichever is visible.
  const firstRouter = page.locator('tbody tr, ul > li').filter({ visible: true }).first();
  await expect(firstRouter).toContainText('Gorom Market');
  await expect(firstRouter).toContainText('Offline');
  await expect(firstRouter).toContainText('Router unreachable');
  await expect(firstRouter).not.toContainText('ehostunreach');
  await expect(page.getByRole('img', { name: /Lologo Gate: .*% uptime over 7 days/ }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Demo', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'dashboard');
});

test('routers list and router detail tabs', async ({ page }) => {
  await signIn(page);
  await page.goto('/routers');
  await expect(page.getByRole('heading', { name: 'Routers' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'routers');

  await page.goto('/routers/r-1');
  await expect(page.getByRole('heading', { name: 'Lologo Gate' })).toBeVisible();
  await expect(page.getByText('Credentials set')).toBeVisible();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connected and logged in/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'router-overview');

  await page.getByRole('tab', { name: 'System' }).click();
  await expect(page.getByText('cpu-temperature')).toBeVisible();
  await shot(page, 'router-system');
  await page.getByRole('tab', { name: 'Hotspot discovery' }).click();
  await expect(page.getByText('Drift detected')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'router-hotspot');
});

test('onboarding wizard shows the RouterOS script with the router’s own addresses', async ({ page }) => {
  await signIn(page);
  await page.goto('/routers/r-4/onboard');
  await expect(page.getByRole('heading', { name: 'Run this script on the router' })).toBeVisible();
  const script = page.getByLabel('RouterOS setup script');
  await expect(script).toContainText('address=10.77.0.5/32 network=10.77.0.1');
  await expect(script).toContainText('endpoint-address=wg.hotzonex.com endpoint-port=51820');
  await expect(script).toContainText('policy=read,write,api,test');
  await expect(page.getByText('Credentials encrypted and stored by the connector.')).toBeVisible();
  // The generated password is visible in the script but must never be persisted by the browser.
  const text = (await script.textContent()) ?? '';
  const password = /password="([A-Za-z0-9]+)"/.exec(text)?.[1];
  expect(password).toMatch(/^[A-Za-z0-9]{32}$/);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie }));
  expect(stored).not.toContain(password as string);
  await expectNoHorizontalScroll(page);
  await shot(page, 'wizard-connect');

  // One task per screen: the script and the key that comes back are separate steps.
  await page.getByRole('button', { name: 'I have run the script' }).click();
  await expect(page.getByRole('heading', { name: 'Paste the line the router printed' })).toBeVisible();
  await expect(page.getByLabel('Router output')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'wizard-key');
});

test('a router on this network is added by address, username and password', async ({ page }) => {
  await signIn(page);
  await page.goto('/routers/new');
  await expect(page.getByRole('heading', { name: 'Add a router on this network' })).toBeVisible();

  // The defaults are what a factory-fresh MikroTik answers on.
  await expect(page.getByLabel('Address')).toHaveValue('192.168.88.1');
  await expect(page.getByLabel('Username')).toHaveValue('admin');
  await expect(page.getByLabel('Port')).toHaveValue('8728');

  // The password is typed, hidden by default, and revealable.
  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await password.fill('router-secret');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expectNoHorizontalScroll(page);
  await shot(page, 'wizard-lan-connect');

  // The connector opens the connection, so it must stay on a private network.
  await page.getByLabel('Address').fill('8.8.8.8');
  await page.getByLabel('Name *', { exact: true }).fill('Juba Market Gate');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/private network/i)).toBeVisible();

  await page.getByLabel('Address').fill('10.77.0.9');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/reserved for Hotzonex tunnels/i)).toBeVisible();
});

test('a local router is offered remote access, and can decline', async ({ page }) => {
  await signIn(page);
  await page.goto('/routers/r-5/onboard');
  await expect(page.getByRole('heading', { name: 'Reach this router from anywhere?' })).toBeVisible();
  // The tunnel address was reserved when the router was added; this is where it starts being used.
  await expect(page.getByText('10.77.0.9')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes, set up remote access' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'wizard-remote');

  // Declining is a first-class answer, not a dead end.
  await page.getByRole('button', { name: 'Not now — keep it local' }).click();
  await expect(page.getByRole('heading', { name: 'Discover the router' })).toBeVisible();
});

test('adding a router over a tunnel starts with a name and a picture of the cable', async ({ page }) => {
  await signIn(page);
  await page.goto('/routers/new?mode=tunnel');
  await expect(page.getByRole('heading', { name: 'Name this router' })).toBeVisible();
  // Connection settings are real but folded away: onboarding asks for a name and nothing else.
  await expect(page.getByLabel('Router name')).toBeVisible();
  await expect(page.getByLabel('API protocol')).toBeHidden();
  const progress = page.getByRole('progressbar', { name: 'Onboarding progress' });
  await expect(progress).toHaveAttribute('aria-valuenow', '1');
  await expectNoHorizontalScroll(page);
  await shot(page, 'wizard-details');

  await page.getByLabel('Router name').fill('Juba Market Gate');
  await page.getByRole('button', { name: 'Create and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Connect your router to the internet' })).toBeVisible();
  await expect(page.locator('strong', { hasText: 'ether 1' })).toBeVisible();
  await expect(page.getByText(/hear a click/i)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'wizard-prepare');

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Get your router’s username and password' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'wizard-credentials');
});

test('locations, audit and settings render', async ({ page }) => {
  await signIn(page);
  await page.goto('/locations');
  await expect(page.getByText('Hotzonex Lologo One')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'locations');
  await page.getByRole('button', { name: 'Hotzonex Lologo One', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Assigned routers');
  await shot(page, 'location-panel');
  await page.keyboard.press('Escape');

  await page.goto('/audit');
  await expect(page.getByText('Connection test requested')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'audit');

  await page.goto('/settings?tab=system');
  await expect(page.getByText('vps-juba-1')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'settings');
});

test('dark mode is selectable and applied', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await shot(page, 'dashboard-dark');

  // The wizard illustrations are drawn with theme variables, so they must follow.
  await page.goto('/routers/r-4/onboard');
  await expect(page.getByRole('heading', { name: 'Run this script on the router' })).toBeVisible();
  await shot(page, 'wizard-dark');
});
