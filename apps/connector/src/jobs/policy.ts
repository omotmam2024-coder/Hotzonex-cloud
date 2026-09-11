import { computeBackoffMs, isConnectivityError, isRetryableError, type MikrotikErrorCode } from '@hotzonex/mikrotik';
import type { JobErrorCode, JobTypePolicy } from '@hotzonex/shared/jobs';
import type { FinishOutcome } from '../store/store.js';

export const RETRY_BACKOFF = { baseMs: 30_000, maxMs: 60 * 60_000, jitter: 0.2 } as const;
export const DEFER_BACKOFF = { baseMs: 60_000, maxMs: 15 * 60_000, jitter: 0.2 } as const;

export interface FailureDecision {
  outcome: FinishOutcome;
  /** For retry/defer: when to try again. */
  runAfter: Date | null;
  /** Defer without consuming an attempt (the router was offline, the job did not really fail). */
  refundAttempt: boolean;
}

export interface FailureInput {
  policy: JobTypePolicy;
  code: JobErrorCode;
  /** Attempts so far, including the one that just failed. */
  attempts: number;
  deferrals: number;
  /** When a circuit breaker is open, the time it next allows a probe. */
  circuitOpenUntil?: number | null;
  now: number;
  random?: () => number;
}

/**
 * What to do with a job whose attempt failed:
 *   - router offline and the job type waits for routers → defer, attempt refunded
 *   - destructive job → failed; a human must confirm a re-run (never auto-retried)
 *   - retryable error with attempts left → retry with exponential backoff + jitter
 *   - retryable error, attempts exhausted → dead (single-shot jobs → failed)
 *   - non-retryable error (bad credentials, permissions, TLS…) → failed
 */
export function decideOnFailure(input: FailureInput): FailureDecision {
  const { policy, code, attempts, deferrals, now } = input;
  const mikrotik = code as MikrotikErrorCode;
  const offline = isConnectivityError(mikrotik) || input.circuitOpenUntil !== undefined && input.circuitOpenUntil !== null;

  if (offline && policy.deferWhenOffline && !policy.destructive) {
    const backoff = computeBackoffMs(deferrals + 1, { ...DEFER_BACKOFF, random: input.random });
    const until = Math.max(now + backoff, input.circuitOpenUntil ?? 0);
    return { outcome: 'defer', runAfter: new Date(until), refundAttempt: true };
  }
  if (policy.destructive) return { outcome: 'failed', runAfter: null, refundAttempt: false };

  const retryable = isRetryableError(mikrotik) || code === 'INTERNAL';
  if (retryable && attempts < policy.maxAttempts) {
    return {
      outcome: 'retry',
      runAfter: new Date(now + computeBackoffMs(attempts, { ...RETRY_BACKOFF, random: input.random })),
      refundAttempt: false,
    };
  }
  if (retryable && policy.maxAttempts > 1) return { outcome: 'dead', runAfter: null, refundAttempt: false };
  return { outcome: 'failed', runAfter: null, refundAttempt: false };
}

/** Deferral before an attempt starts (router already known offline / credentials still being stored). */
export function deferBeforeStart(deferrals: number, now: number, minUntil = 0, random?: () => number): Date {
  return new Date(Math.max(now + computeBackoffMs(deferrals + 1, { ...DEFER_BACKOFF, random }), minUntil));
}
