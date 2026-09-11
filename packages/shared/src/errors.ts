import type { MikrotikErrorCode } from '@hotzonex/mikrotik/errors';
import type { JobErrorCode } from './jobs.js';

/**
 * Every failure a user can meet, as a specific human sentence: what happened,
 * why it usually happens, and what to do next. A raw error string or stack
 * trace reaching the browser is a defect; the UI renders these instead.
 */
export interface HumanError {
  title: string;
  explanation: string;
  nextAction: string;
}

export const MIKROTIK_ERROR_MESSAGES: Record<MikrotikErrorCode, HumanError> = {
  UNREACHABLE: {
    title: 'Router unreachable',
    explanation:
      'The connector could not reach the router over the WireGuard tunnel. The router may be powered off, have no internet, or the tunnel has not come up yet.',
    nextAction: 'Check the router has power and internet, then look at "Last handshake" on the router page. Hotzonex retries automatically.',
  },
  TIMEOUT: {
    title: 'Router did not answer in time',
    explanation:
      'The router accepted nothing or replied too slowly within 10 seconds. This is common on a congested or failing Starlink link, or when the router is overloaded.',
    nextAction: 'Wait a minute and try again. If it keeps happening, check the router CPU and the site uplink.',
  },
  AUTH_FAILED: {
    title: 'Login rejected',
    explanation: 'The router rejected the API username or password.',
    nextAction: 'Run the onboarding script again (it resets the hotzonex-api user) or enter the correct credentials under Router → Credentials.',
  },
  API_DISABLED: {
    title: 'API service refused the connection',
    explanation:
      'The router answered but refused the API port. The API service is disabled, uses a different port, or is limited to other addresses.',
    nextAction: 'In the router terminal run: /ip service print — make sure the service is enabled on the expected port and allows 10.77.0.1.',
  },
  PORT_BLOCKED: {
    title: 'API port blocked',
    explanation: 'The tunnel is up but a firewall rule is stopping traffic to the API port.',
    nextAction: 'Make sure the "Hotzonex Cloud API via tunnel" firewall rule is above any drop rules: /ip firewall filter print.',
  },
  TLS_ERROR: {
    title: 'Secure connection failed',
    explanation:
      'TLS negotiation failed. api-ssl and HTTPS need a certificate assigned on the router, and RouterOS certificates are usually self-signed.',
    nextAction: 'Traffic already runs inside the encrypted WireGuard tunnel: switch the router to the plain API protocol (port 8728), or assign a certificate.',
  },
  PERMISSION_DENIED: {
    title: 'Not enough permissions',
    explanation: 'The router accepted the login but the API user\'s group lacks a policy this action needs.',
    nextAction: 'Run "Test permissions" to see exactly which policy is missing, then re-run the onboarding script to reset the group.',
  },
  NOT_FOUND: {
    title: 'Item not found on the router',
    explanation: 'The router says the item does not exist. It may have been removed on the router directly.',
    nextAction: 'Run a sync to refresh what Hotzonex knows about this router.',
  },
  ALREADY_EXISTS: {
    title: 'Already exists on the router',
    explanation: 'The router already has an item with that name.',
    nextAction: 'Run a sync, then choose a different name or reuse the existing item.',
  },
  INVALID_COMMAND: {
    title: 'Router did not understand the request',
    explanation:
      'The router rejected the command. This usually means an older or unexpected RouterOS version, or a missing package (for example hotspot).',
    nextAction: 'Hotzonex Cloud needs RouterOS v7. Check the version on the System tab and upgrade if needed.',
  },
  UNKNOWN: {
    title: 'Unexpected router response',
    explanation: 'The router replied with something Hotzonex could not interpret, or the connection failed in an unusual way.',
    nextAction: 'Try again. If it persists, fetch the router logs and contact Hotzonex support with the time of the failure.',
  },
};

export const JOB_ERROR_MESSAGES: Record<Exclude<JobErrorCode, MikrotikErrorCode>, HumanError> = {
  EXPIRED: {
    title: 'Gave up waiting for the router',
    explanation: 'The router stayed offline for longer than this job was allowed to wait (7 days).',
    nextAction: 'Bring the router back online, then run the action again.',
  },
  NO_CREDENTIALS: {
    title: 'No API credentials',
    explanation: 'This router has no stored API credentials, so the connector cannot log in.',
    nextAction: 'Open the router and set its credentials, or finish the onboarding wizard.',
  },
  CREDENTIALS_UNREADABLE: {
    title: 'Credentials could not be read',
    explanation:
      'The connector could not decrypt the submitted credentials — usually because its encryption key changed after they were entered.',
    nextAction: 'Enter the router credentials again.',
  },
  ROUTER_NOT_FOUND: {
    title: 'Router no longer exists',
    explanation: 'The router was deleted before this job ran.',
    nextAction: 'No action needed.',
  },
  INTERNAL: {
    title: 'Hotzonex connector error',
    explanation: 'The connector hit an internal problem while running this job. The router was not changed.',
    nextAction: 'Try again. If it persists, check the connector logs (see RUNBOOK.md).',
  },
};

export function describeJobError(code: string | null | undefined): HumanError {
  if (code && code in MIKROTIK_ERROR_MESSAGES) return MIKROTIK_ERROR_MESSAGES[code as MikrotikErrorCode];
  if (code && code in JOB_ERROR_MESSAGES) return JOB_ERROR_MESSAGES[code as keyof typeof JOB_ERROR_MESSAGES];
  return JOB_ERROR_MESSAGES.INTERNAL;
}

/** Messages for errors raised by our database functions (PostgREST `hint`). */
export const DB_HINT_MESSAGES: Record<string, string> = {
  forbidden: 'You do not have permission to do that.',
  not_found: 'That item no longer exists or you do not have access to it.',
  rate_limited: 'Too many requests in a short time. Wait a minute and try again.',
  credentials_missing: 'Set this router\'s API credentials first.',
  invalid_envelope: 'The credentials could not be prepared securely. Reload the page and try again.',
  invalid_payload: 'The request was not valid.',
  invalid_job_type: 'That action is not available.',
  idempotency_conflict: 'This request was already used for something else. Reload the page and try again.',
  invalid_idempotency_key: 'The request was incomplete. Reload the page and try again.',
  invalid_role: 'That role cannot be assigned.',
  invalid_email: 'Enter a valid email address.',
  already_member: 'That email already belongs to a Hotzonex Cloud user.',
  self_change: 'You cannot change your own role or status.',
  invite_required: 'Hotzonex Cloud is invite-only. Ask an administrator for an invitation.',
  invite_invalid: 'This invitation is invalid, expired, or for a different email address.',
  pool_exhausted: 'No tunnel addresses are left. Contact Hotzonex support.',
  audit_immutable: 'Audit entries cannot be changed.',
};
