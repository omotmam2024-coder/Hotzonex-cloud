import type { RouterRow } from '@hotzonex/shared/database';

/**
 * Two ways in, because there are two situations.
 *
 * `lan` — the technician is on the same network as the router. Type its
 * address and a login that already works, press Connect, done. This is the
 * normal case and the default.
 *
 * `tunnel` — the router is at a remote site behind CGNAT, where nothing can
 * dial in. A setup script puts it on a WireGuard tunnel first, and it is
 * reached at its tunnel address afterwards.
 *
 * Either way the connector does the connecting, so it has to be able to reach
 * the address: a connector on a VPS cannot see 192.168.88.1.
 */
export type WizardMode = 'lan' | 'tunnel';

export const WIZARD_STEPS = [
  { key: 'connect', label: 'Connect', modes: ['lan'] },
  { key: 'details', label: 'Router details', modes: ['tunnel'] },
  { key: 'prepare', label: 'Plug it in', modes: ['tunnel'] },
  { key: 'credentials', label: 'Router password', modes: ['tunnel'] },
  { key: 'script', label: 'Run the script', modes: ['tunnel'] },
  { key: 'key', label: 'Paste the key', modes: ['tunnel'] },
  { key: 'test', label: 'Test connection', modes: ['lan', 'tunnel'] },
  { key: 'discover', label: 'Discover', modes: ['lan', 'tunnel'] },
  { key: 'hotspot', label: 'Hotspot', modes: ['lan', 'tunnel'] },
  { key: 'location', label: 'Location', modes: ['lan', 'tunnel'] },
  { key: 'finish', label: 'Finish', modes: ['lan', 'tunnel'] },
] as const satisfies readonly { key: string; label: string; modes: readonly WizardMode[] }[];

export type WizardStep = (typeof WIZARD_STEPS)[number]['key'];

export function stepsFor(mode: WizardMode): WizardStep[] {
  return WIZARD_STEPS.filter((s) => (s.modes as readonly WizardMode[]).includes(mode)).map((s) => s.key);
}

type RouterState = Pick<
  RouterRow,
  | 'credentials_status'
  | 'host'
  | 'wg_address'
  | 'wg_public_key'
  | 'is_demo'
  | 'last_seen_at'
  | 'discovered_at'
  | 'hotspot_server_id'
  | 'onboarding_completed_at'
  | 'location_id'
>;

/**
 * A router reached at its own tunnel address went through the script; anything
 * else was added by address on the local network. The database keeps the two
 * apart: 10.77.0.0/16 is the tunnel pool, and a router's host may only be in it
 * when it is that router's own tunnel address.
 */
export function routerMode(router: Pick<RouterState, 'host' | 'wg_address'>): WizardMode {
  return router.host === router.wg_address ? 'tunnel' : 'lan';
}

/**
 * Where to resume a half-finished onboarding. Credentials are never stored in
 * the browser, so a router without them goes back to the screen that asks for
 * them — the script for a tunnel router, the connect form for a local one.
 */
export function resumeStep(router: RouterState | null | undefined): WizardStep {
  if (!router) return 'connect';
  if (router.onboarding_completed_at) return 'finish';

  const missingCredentials = !router.is_demo && (router.credentials_status === 'not_set' || router.credentials_status === 'rejected');
  if (routerMode(router) === 'lan') {
    if (missingCredentials) return 'connect';
  } else {
    if (missingCredentials) return 'script';
    if (!router.is_demo && !router.wg_public_key) return 'script';
  }

  if (!router.last_seen_at) return 'test';
  if (!router.discovered_at) return 'discover';
  if (!router.hotspot_server_id) return 'hotspot';
  if (!router.location_id) return 'location';
  return 'finish';
}

export function stepIndex(step: WizardStep, mode: WizardMode): number {
  return stepsFor(mode).indexOf(step);
}

/** The step before `step`, for the header's back arrow. Null means "leave the wizard". */
export function previousStep(step: WizardStep, mode: WizardMode): WizardStep | null {
  const steps = stepsFor(mode);
  const i = steps.indexOf(step);
  return i > 0 ? (steps[i - 1] ?? null) : null;
}
