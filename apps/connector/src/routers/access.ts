import {
  MockMikrotikProvider,
  RouterConnectionPool,
  createProvider,
  type BreakerSnapshot,
  type ConnectionParams,
  type MikrotikProvider,
  type MockBehavior,
  type PoolOptions,
  type ProviderFactory,
  type ProviderKind,
} from '@hotzonex/mikrotik';
import type { Keyring } from '../crypto/keyring.js';

/** The subset of a router row needed to reach it. */
export interface RouterTarget {
  id: string;
  host: string;
  api_protocol: 'api' | 'api_ssl' | 'rest';
  api_port: number;
  use_ssl: boolean;
  is_demo: boolean;
  username: string | null;
  password_ciphertext: string | null;
  key_version: number | null;
}

export class NoCredentialsError extends Error {
  override readonly name = 'NoCredentialsError';
  constructor() {
    super('router has no stored credentials');
  }
}

export interface RouterAccessOptions {
  kind: ProviderKind;
  keyring: Keyring;
  /** Behaviour for mock-served routers (dev state file; tests inject directly). */
  mockBehavior?: (routerId: string, host: string) => MockBehavior;
  pool?: PoolOptions;
  /** Per-call timeout inside the pool (connect and each command). */
  timeoutMs?: number;
  /** Overrides how non-demo routers are reached (tests substitute a recording mock here). */
  factory?: ProviderFactory;
}

/**
 * Chooses how to reach each router and keeps one pooled session per router.
 * DEMO routers are always served by the mock provider, whatever
 * MIKROTIK_PROVIDER says, so they can never be mistaken for real hardware.
 */
export class RouterAccess {
  private readonly realPool: RouterConnectionPool;
  private readonly mockPool: RouterConnectionPool;
  private readonly hostToId = new Map<string, string>();

  constructor(private readonly opts: RouterAccessOptions) {
    const mockFactory = (params: ConnectionParams): MikrotikProvider =>
      new MockMikrotikProvider(params, {
        behavior: () => this.opts.mockBehavior?.(this.hostToId.get(params.host) ?? '', params.host) ?? {},
        latencyMs: 40,
      });
    this.mockPool = new RouterConnectionPool(mockFactory, opts.pool);
    if (opts.factory) this.realPool = new RouterConnectionPool(opts.factory, opts.pool);
    else if (opts.kind === 'mock') this.realPool = this.mockPool;
    else this.realPool = new RouterConnectionPool((p) => createProvider(opts.kind, p), opts.pool);
  }

  get providerKind(): ProviderKind {
    return this.opts.kind;
  }

  isMockServed(router: Pick<RouterTarget, 'is_demo'>): boolean {
    return router.is_demo || this.opts.kind === 'mock';
  }

  private pool(router: Pick<RouterTarget, 'is_demo'>): RouterConnectionPool {
    return router.is_demo ? this.mockPool : this.realPool;
  }

  hasCredentials(router: RouterTarget): boolean {
    return router.is_demo || (router.username !== null && router.password_ciphertext !== null && router.key_version !== null);
  }

  /** Decrypts the password for one call. The plaintext lives only inside ConnectionParams passed to the pool. */
  private params(router: RouterTarget): ConnectionParams {
    const base = {
      host: router.host,
      port: router.api_port,
      protocol: router.api_protocol,
      useSsl: router.api_protocol === 'api_ssl' ? true : router.api_protocol === 'api' ? false : router.use_ssl,
      timeoutMs: this.opts.timeoutMs ?? 10_000,
      // RouterOS ships self-signed certificates and the tunnel already authenticates the peer.
      tls: { rejectUnauthorized: false },
    };
    if (router.is_demo) return { ...base, username: 'demo', password: 'demo-router-no-secret' };
    if (!router.username || !router.password_ciphertext || router.key_version === null) throw new NoCredentialsError();
    const password = this.opts.keyring.decrypt(router.password_ciphertext, router.key_version, router.id);
    return { ...base, username: router.username, password };
  }

  run<T>(router: RouterTarget, fn: (p: MikrotikProvider) => Promise<T>): Promise<T> {
    this.hostToId.set(router.host, router.id);
    return this.pool(router).run(router.id, this.params(router), fn);
  }

  breaker(router: Pick<RouterTarget, 'id' | 'is_demo'>): BreakerSnapshot {
    return this.pool(router).snapshot(router.id);
  }

  isCircuitOpen(router: Pick<RouterTarget, 'id' | 'is_demo'>): boolean {
    return this.pool(router).isOpen(router.id);
  }

  resetBreaker(router: Pick<RouterTarget, 'id' | 'is_demo'>): void {
    this.pool(router).reset(router.id);
  }

  async closeAll(): Promise<void> {
    await this.mockPool.closeAll();
    if (this.realPool !== this.mockPool) await this.realPool.closeAll();
  }
}
