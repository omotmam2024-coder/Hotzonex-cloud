import type { RouterRow } from '@hotzonex/shared/database';

export const WIZARD_STEPS = [
  { key: 'details', label: 'Router details' },
  { key: 'connect', label: 'Connect router' },
  { key: 'test', label: 'Test connection' },
  { key: 'discover', label: 'Discover' },
  { key: 'hotspot', label: 'Hotspot' },
  { key: 'location', label: 'Location' },
  { key: 'finish', label: 'Finish' },
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number]['key'];

type RouterState = Pick<
  RouterRow,
  | 'credentials_status'
  | 'wg_public_key'
  | 'is_demo'
  | 'last_seen_at'
  | 'discovered_at'
  | 'hotspot_server_id'
  | 'onboarding_completed_at'
  | 'location_id'
>;

/**
 * Where to resume a half-finished onboarding. Credentials are never stored
 * in the browser, so if the router has none (or they were rejected) the
 * wizard returns to "Connect" and issues a fresh password.
 */
export function resumeStep(router: RouterState | null | undefined): WizardStep {
  if (!router) return 'details';
  if (router.onboarding_completed_at) return 'finish';
  const needsTunnel = !router.is_demo && !router.wg_public_key;
  if (!router.is_demo && (router.credentials_status === 'not_set' || router.credentials_status === 'rejected')) return 'connect';
  if (needsTunnel) return 'connect';
  if (!router.last_seen_at) return 'test';
  if (!router.discovered_at) return 'discover';
  if (!router.hotspot_server_id) return 'hotspot';
  if (!router.location_id) return 'location';
  return 'finish';
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.key === step);
}
