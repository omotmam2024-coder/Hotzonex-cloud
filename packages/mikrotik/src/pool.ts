import { createHash } from 'node:crypto';
import { computeBackoffMs } from './backoff.js';
import { MikrotikError, isMikrotikError } from './errors.js';
import { DEFAULT_TIMEOUT_MS, type MikrotikProvider } from './provider.js';
import type { ConnectionParams } from './types.js';

export type ProviderFactory = (params: ConnectionParams) => MikrotikProvider;

export interface BreakerOptions {
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
}

export interface PoolOptions {
  /** Close an idle session after this long. Keeps metered links quiet between polls. */
  idleTimeoutMs?: number;
  /** Hard ceiling for one pooled operation (connect + all commands inside `run`). */
  operationTimeoutMs?: number;
  breaker?: Partial<BreakerOptions>;
  now?: () => number;
  random?: () => number;
}

export type BreakerStatus = 'closed' | 'open' | 'half_open';

export interface BreakerSnapshot {
  status: BreakerStatus;
  consecutiveFailures: number;
  /** Epoch ms when an open circuit next allows a probe; null when closed. */
  openUntil: number | null;
  lastErrorCode: string | null;
}

/** Thrown instead of contacting a router whose circuit is open. Not a MikrotikError: the router was not asked. */
export class CircuitOpenError extends Error {
  override readonly name = 'CircuitOpenError';
  constructor(
    readonly key: string,
    readonly openUntil: number,
  ) {
    super(`circuit open for ${key} until ${new Date(openUntil).toISOString()}`);
  }
}

interface Entry {
  provider: MikrotikProvider | null;
  fingerprint: string | null;
  queue: Promise<unknown>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  failures: number;
  openCount: number;
  openUntil: number | null;
  halfOpenInFlight: boolean;
  lastErrorCode: string | null;
}

const DEFAULT_BREAKER: BreakerOptions = { failureThreshold: 3, baseCooldownMs: 60_000, maxCooldownMs: 30 * 60_000 };

function fingerprint(params: ConnectionParams): string {
  // Detects credential/endpoint changes without keeping another copy of the password around.
  return createHash('sha256')
    .update(JSON.stringify([params.host, params.port, params.protocol, params.useSsl, params.username, params.password]))
    .digest('hex');
}

/** Errors that say "this router is not answering properly" and should trip the breaker. */
function tripsBreaker(error: unknown): boolean {
  if (!isMikrotikError(error)) return true;
  return error.stage !== 'command' || error.code === 'TIMEOUT' || error.code === 'UNREACHABLE';
}

/**
 * One session per router, serialised; a hard timeout around every operation;
 * a circuit breaker that stops hammering a router after N consecutive
 * failures, reopening with exponential backoff + jitter.
 */
export class RouterConnectionPool {
  private readonly entries = new Map<string, Entry>();
  private readonly breaker: BreakerOptions;
  private readonly idleTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly factory: ProviderFactory,
    opts: PoolOptions = {},
  ) {
    this.breaker = { ...DEFAULT_BREAKER, ...opts.breaker };
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
    this.operationTimeoutMs = opts.operationTimeoutMs ?? DEFAULT_TIMEOUT_MS * 3;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  private entry(key: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = {
        provider: null,
        fingerprint: null,
        queue: Promise.resolve(),
        idleTimer: null,
        failures: 0,
        openCount: 0,
        openUntil: null,
        halfOpenInFlight: false,
        lastErrorCode: null,
      };
      this.entries.set(key, e);
    }
    return e;
  }

  snapshot(key: string): BreakerSnapshot {
    const e = this.entries.get(key);
    if (!e) return { status: 'closed', consecutiveFailures: 0, openUntil: null, lastErrorCode: null };
    let status: BreakerStatus = 'closed';
    if (e.openUntil !== null) status = this.now() >= e.openUntil ? 'half_open' : 'open';
    return { status, consecutiveFailures: e.failures, openUntil: e.openUntil, lastErrorCode: e.lastErrorCode };
  }

  /** True when a call right now would be refused without contacting the router. */
  isOpen(key: string): boolean {
    return this.snapshot(key).status === 'open';
  }

  /** Forget breaker state, e.g. after an operator fixes credentials. */
  reset(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.failures = 0;
    e.openCount = 0;
    e.openUntil = null;
    e.lastErrorCode = null;
  }

  run<T>(key: string, params: ConnectionParams, fn: (provider: MikrotikProvider) => Promise<T>): Promise<T> {
    const e = this.entry(key);
    const task = e.queue.then(
      () => this.execute(key, e, params, fn),
      () => this.execute(key, e, params, fn),
    );
    e.queue = task.catch(() => undefined);
    return task;
  }

  private async execute<T>(key: string, e: Entry, params: ConnectionParams, fn: (p: MikrotikProvider) => Promise<T>): Promise<T> {
    const snap = this.snapshot(key);
    if (snap.status === 'open' && snap.openUntil !== null) throw new CircuitOpenError(key, snap.openUntil);
    if (snap.status === 'half_open') {
      if (e.halfOpenInFlight) throw new CircuitOpenError(key, snap.openUntil ?? this.now());
      e.halfOpenInFlight = true;
    }

    if (e.idleTimer) {
      clearTimeout(e.idleTimer);
      e.idleTimer = null;
    }

    const fp = fingerprint(params);
    if (e.provider && e.fingerprint !== fp) {
      await e.provider.disconnect().catch(() => undefined);
      e.provider = null;
    }
    if (!e.provider) {
      e.provider = this.factory(params);
      e.fingerprint = fp;
    }
    const provider = e.provider;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new MikrotikError('TIMEOUT', 'command', `operation exceeded ${this.operationTimeoutMs} ms`)),
        this.operationTimeoutMs,
      );
    });

    try {
      await Promise.race([provider.connect(), timeout]);
      const result = await Promise.race([fn(provider), timeout]);
      this.recordSuccess(e);
      this.scheduleIdleClose(e);
      return result;
    } catch (error) {
      if (tripsBreaker(error)) {
        await provider.disconnect().catch(() => undefined);
        e.provider = null;
        this.recordFailure(e, error);
      } else {
        // The router answered (e.g. NOT_FOUND); the session is healthy.
        this.recordSuccess(e);
        this.scheduleIdleClose(e);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      e.halfOpenInFlight = false;
    }
  }

  private recordSuccess(e: Entry): void {
    e.failures = 0;
    e.openCount = 0;
    e.openUntil = null;
    e.lastErrorCode = null;
  }

  private recordFailure(e: Entry, error: unknown): void {
    e.failures += 1;
    e.lastErrorCode = isMikrotikError(error) ? error.code : 'UNKNOWN';
    const wasHalfOpen = e.openUntil !== null;
    if (wasHalfOpen || e.failures >= this.breaker.failureThreshold) {
      e.openCount += 1;
      const cooldown = computeBackoffMs(e.openCount, {
        baseMs: this.breaker.baseCooldownMs,
        maxMs: this.breaker.maxCooldownMs,
        jitter: 0.2,
        random: this.random,
      });
      e.openUntil = this.now() + cooldown;
    }
  }

  private scheduleIdleClose(e: Entry): void {
    if (e.idleTimer) clearTimeout(e.idleTimer);
    e.idleTimer = setTimeout(() => {
      e.idleTimer = null;
      const p = e.provider;
      e.provider = null;
      void p?.disconnect().catch(() => undefined);
    }, this.idleTimeoutMs);
    e.idleTimer.unref?.();
  }

  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      all.map(async (e) => {
        if (e.idleTimer) clearTimeout(e.idleTimer);
        await e.provider?.disconnect().catch(() => undefined);
      }),
    );
  }
}
