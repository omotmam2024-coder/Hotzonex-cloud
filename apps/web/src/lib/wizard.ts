import type { RouterRow } from '@hotzonex/shared/database';

/**
 * One task per step. `prepare` and `credentials` tell the technician what to do
 * with the hardware in front of them and store nothing, so the wizard only ever
 * walks forward into them — `resumeStep` returns the next step that actually
 * has work to do.
 */
export const WIZARD_STEPS = [
  { key: 'details', label: 'Router details' },
  { key: 'prepare', label: 'Plug it in' },
  { key: 'credentials', label: 'Router password' },
  { key: 'script', label: 'Run the script' },
  { key: 'key', label: 'Paste the key' },
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
 * Where to resume a half-finished onboarding. Credentials are never stored in
 * the browser, so if the router has none (or they were rejected) the wizard
 * returns to the script step and issues a fresh password. A router with no
 * tunnel key goes there too: the script is what prints the key.
 */
export function resumeStep(router: RouterState | null | undefined): WizardStep {
  if (!router) return 'details';
  if (router.onboarding_completed_at) return 'finish';
  const needsTunnel = !router.is_demo && !router.wg_public_key;
  if (!router.is_demo && (router.credentials_status === 'not_set' || router.credentials_status === 'rejected')) return 'script';
  if (needsTunnel) return 'script';
  if (!router.last_seen_at) return 'test';
  if (!router.discovered_at) return 'discover';
  if (!router.hotspot_server_id) return 'hotspot';
  if (!router.location_id) return 'location';
  return 'finish';
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.key === step);
}

/** The step before `step`, for the header's back arrow. Null means "leave the wizard". */
export function previousStep(step: WizardStep): WizardStep | null {
  const i = stepIndex(step);
  return i > 0 ? (WIZARD_STEPS[i - 1]!.key as WizardStep) : null;
}
