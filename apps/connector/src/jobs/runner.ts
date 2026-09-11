import { CircuitOpenError, isMikrotikError } from '@hotzonex/mikrotik';
import { JOB_TYPES, type JobErrorCode, type JobType, type JobTypePolicy } from '@hotzonex/shared/jobs';
import { SealError } from '@hotzonex/shared/sealing';
import type { Keyring } from '../crypto/keyring.js';
import { KeyringError } from '../crypto/keyring.js';
import type { SealingKeys } from '../crypto/sealing-keys.js';
import type { Logger } from '../logger.js';
import { NoCredentialsError, type RouterAccess } from '../routers/access.js';
import type { ConnectorStore, JobRow } from '../store/store.js';
import { JobFailure, type JobHandler } from './context.js';
import { HANDLERS } from './handlers.js';
import { decideOnFailure, deferBeforeStart } from './policy.js';

export interface JobRunnerOptions {
  connectorId: string;
  concurrency: number;
  /** A claim older than this is considered abandoned (crashed connector) and re-claimable. */
  leaseSeconds: number;
  store: ConnectorStore;
  access: RouterAccess;
  keyring: Keyring;
  sealing: SealingKeys;
  log: Logger;
  now?: () => number;
  random?: () => number;
  /** Job types this runner executes. Defaults to the Phase 1 registry. */
  registry?: Record<string, RegisteredJob>;
}

export interface RegisteredJob {
  policy: JobTypePolicy;
  handler: JobHandler;
  needsConnection: boolean;
}

export const DEFAULT_REGISTRY: Record<string, RegisteredJob> = Object.fromEntries(
  Object.entries(HANDLERS).map(([type, h]) => [type, { policy: JOB_TYPES[type as JobType], ...h }]),
);

/** Wait this long for credentials that are still being stored before running a job that needs them. */
const CREDENTIALS_PENDING_WAIT_MS = 5_000;

function classify(error: unknown): { code: JobErrorCode; message: string } {
  if (isMikrotikError(error)) return { code: error.code, message: error.detail ?? error.code };
  if (error instanceof CircuitOpenError) return { code: 'UNREACHABLE', message: 'router is not answering; waiting before trying again' };
  if (error instanceof JobFailure) return { code: error.code, message: error.message };
  if (error instanceof NoCredentialsError) return { code: 'NO_CREDENTIALS', message: error.message };
  if (error instanceof KeyringError || error instanceof SealError) return { code: 'CREDENTIALS_UNREADABLE', message: error.message };
  return { code: 'INTERNAL', message: 'internal connector error' };
}

/**
 * Claims jobs atomically from the data plane and runs them. Offline routers
 * are the normal case: jobs that need a router wait (without burning
 * attempts) until it comes back; the UI never blocks on any of this.
 */
export class JobRunner {
  private inFlight = new Set<Promise<void>>();
  private readonly now: () => number;

  constructor(private readonly o: JobRunnerOptions) {
    this.now = o.now ?? Date.now;
  }

  get busy(): number {
    return this.inFlight.size;
  }

  /** Claim what capacity allows and start running it. Returns the number claimed. */
  async tick(): Promise<number> {
    const capacity = this.o.concurrency - this.inFlight.size;
    if (capacity <= 0) return 0;
    const jobs = await this.o.store.claimJobs(this.o.connectorId, capacity, this.o.leaseSeconds);
    for (const job of jobs) {
      const p = this.execute(job)
        .catch((error: unknown) => {
          this.o.log.error({ jobId: job.id, err: { name: (error as Error).name } }, 'job bookkeeping failed; the claim lease will expire and the job will be retried');
        })
        .finally(() => this.inFlight.delete(p));
      this.inFlight.add(p);
    }
    return jobs.length;
  }

  /** Test helper and graceful shutdown: wait for everything in flight. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private async finish(job: JobRow, args: Omit<Parameters<ConnectorStore['finishJob']>[0], 'jobId' | 'connectorId'>): Promise<void> {
    await this.o.store.finishJob({ jobId: job.id, connectorId: this.o.connectorId, ...args });
  }

  private async execute(job: JobRow): Promise<void> {
    const log = this.o.log.child({ jobId: job.id, type: job.type, routerId: job.router_id });

    const registered = (this.o.registry ?? DEFAULT_REGISTRY)[job.type];
    if (!registered) {
      await this.finish(job, { outcome: 'failed', errorCode: 'INTERNAL', error: `unknown job type ${job.type}` });
      return;
    }
    const { policy, handler, needsConnection } = registered;

    const router = job.router_id ? await this.o.store.getRouter(job.router_id) : null;
    if (job.router_id && !router) {
      await this.finish(job, { outcome: 'failed', errorCode: 'ROUTER_NOT_FOUND', error: 'router no longer exists' });
      return;
    }

    if (needsConnection && router) {
      // Known offline (breaker open) and this job waits for routers: do not even try.
      const breaker = this.o.access.breaker(router);
      if (breaker.status === 'open' && policy.deferWhenOffline) {
        const runAfter = deferBeforeStart(job.deferrals, this.now(), breaker.openUntil ?? 0, this.o.random);
        log.info({ runAfter }, 'router offline; job deferred');
        await this.finish(job, { outcome: 'defer', runAfter, errorCode: 'UNREACHABLE', error: 'waiting for the router to come back online' });
        return;
      }
      if (!this.o.access.hasCredentials(router)) {
        if (router.credentials_status === 'pending') {
          await this.finish(job, {
            outcome: 'defer',
            runAfter: new Date(this.now() + CREDENTIALS_PENDING_WAIT_MS),
            errorCode: 'NO_CREDENTIALS',
            error: 'waiting for credentials to be stored',
          });
          return;
        }
        await this.finish(job, { outcome: 'failed', errorCode: 'NO_CREDENTIALS', error: 'router has no stored credentials' });
        return;
      }
    }

    const started = await this.o.store.startJob(job.id, this.o.connectorId);
    if (!started) {
      log.warn('lost the claim before starting; another connector owns this job');
      return;
    }

    try {
      const result = await handler({
        job: started,
        router,
        store: this.o.store,
        access: this.o.access,
        keyring: this.o.keyring,
        sealing: this.o.sealing,
        log,
        now: this.now,
      });
      await this.finish(started, { outcome: 'succeeded', result: result as never });
      log.info('job succeeded');
    } catch (error) {
      const { code, message } = classify(error);
      const decision = decideOnFailure({
        policy,
        code,
        attempts: started.attempts,
        deferrals: started.deferrals,
        circuitOpenUntil: error instanceof CircuitOpenError ? error.openUntil : null,
        now: this.now(),
        ...(this.o.random ? { random: this.o.random } : {}),
      });
      await this.finish(started, {
        outcome: decision.outcome,
        errorCode: code,
        error: message,
        runAfter: decision.runAfter,
        refundAttempt: decision.refundAttempt,
      });
      const level = decision.outcome === 'defer' || decision.outcome === 'retry' ? 'info' : 'warn';
      log[level]({ code, outcome: decision.outcome, runAfter: decision.runAfter }, 'job attempt failed');
    }
  }
}
