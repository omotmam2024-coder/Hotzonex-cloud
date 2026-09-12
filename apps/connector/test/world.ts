/**
 * A connector wired to a real Postgres (PGlite + every migration) and the
 * mock MikroTik provider. Everything above the transport is production code.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { PGlite } from '@electric-sql/pglite';
import { as, createLocation, createTenant, createTestDb, createUser, rpc, type UserFixture } from '@hotzonex/db/testing';
import { MockMikrotikProvider, type ConnectionParams, type MockBehavior, type MockOptions } from '@hotzonex/mikrotik';
import { Keyring } from '../src/crypto/keyring.js';
import { SealingKeys } from '../src/crypto/sealing-keys.js';
import { HealthPoller } from '../src/health/poller.js';
import { JobRunner, type RegisteredJob } from '../src/jobs/runner.js';
import { createLogger, type Logger } from '../src/logger.js';
import { RouterAccess } from '../src/routers/access.js';
import { ConnectorStore, type RpcTransport } from '../src/store/store.js';

export class PgliteTransport implements RpcTransport {
  constructor(private readonly db: PGlite) {}

  rows(fn: string, args: Record<string, unknown>): Promise<unknown[]> {
    return as(this.db, { kind: 'service' }, (tx) => rpc(tx, fn, args));
  }

  async scalar(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const rows = await this.rows(fn, args);
    return (rows[0] as Record<string, unknown> | undefined)?.[fn] ?? null;
  }
}

/** Captures every log line so tests can assert secrets never reach the logs. */
export class LogCapture extends Writable {
  lines: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.lines.push(chunk.toString('utf8'));
    cb();
  }
  get text(): string {
    return this.lines.join('');
  }
}

export interface World {
  db: PGlite;
  store: ConnectorStore;
  keyring: Keyring;
  sealing: SealingKeys;
  access: RouterAccess;
  runner: JobRunner;
  poller: HealthPoller;
  logs: LogCapture;
  log: Logger;
  tenantId: string;
  admin: UserFixture;
  locationId: string;
  /** Mock provider instances created for non-demo routers, most recent last. */
  providers: MockMikrotikProvider[];
  /** Live, per-router behaviour for the mock (keyed by router id). */
  behaviors: Map<string, MockBehavior>;
  /** Tunnel address → router id, so the mock can look up per-router behaviour. */
  hostToRouter: Map<string, string>;
  mockOptions: Partial<MockOptions>;
  close(): Promise<void>;
}

export async function createWorld(
  opts: { registry?: Record<string, RegisteredJob>; timeoutMs?: number; breakerCooldownMs?: number } = {},
): Promise<World> {
  const db = await createTestDb();
  const tenantId = await createTenant(db, `t-${randomUUID().slice(0, 8)}`);
  const admin = await createUser(db, { email: `admin-${randomUUID().slice(0, 6)}@hz.test`, role: 'ADMIN', tenantId });
  const locationId = await createLocation(db, tenantId, 'Test Site');

  const keyring = Keyring.fromBase64({ version: 1, key: randomBytes(32).toString('base64') });
  const sealing = await SealingKeys.fromKeyring(keyring);
  const store = new ConnectorStore(new PgliteTransport(db));
  const logs = new LogCapture();
  const log = createLogger('debug', logs);

  const providers: MockMikrotikProvider[] = [];
  const behaviors = new Map<string, MockBehavior>();
  const hostToRouter = new Map<string, string>();
  const mockOptions: Partial<MockOptions> = {};

  const access = new RouterAccess({
    kind: 'api',
    keyring,
    timeoutMs: opts.timeoutMs ?? 200,
    pool: {
      breaker: { failureThreshold: 3, baseCooldownMs: opts.breakerCooldownMs ?? 20, maxCooldownMs: (opts.breakerCooldownMs ?? 20) * 2 },
      idleTimeoutMs: 1_000,
    },
    factory: (params: ConnectionParams) => {
      const p = new MockMikrotikProvider(params, {
        ...mockOptions,
        behavior: () => behaviors.get(hostToRouter.get(params.host) ?? '') ?? {},
      });
      providers.push(p);
      return p;
    },
  });

  const runner = new JobRunner({
    connectorId: 'test-connector',
    concurrency: 4,
    leaseSeconds: 60,
    store,
    access,
    keyring,
    sealing,
    log,
    random: () => 0.5,
    ...(opts.registry ? { registry: opts.registry } : {}),
  });
  const poller = new HealthPoller({ store, access, log, connectorId: 'test-connector', defaultIntervalSeconds: 300, tickSeconds: 15, concurrency: 2 });

  const world: World = {
    db, store, keyring, sealing, access, runner, poller, logs, log, tenantId, admin, locationId, providers, behaviors, hostToRouter, mockOptions,
    close: async () => {
      await access.closeAll();
      await db.close();
    },
  };
  return world;
}

/** Insert a router as the admin would (through RLS), then give it real encrypted credentials. */
export async function addRouter(
  w: World,
  opts: { name?: string; password?: string; withCredentials?: boolean; protocol?: 'api' | 'rest'; connectorId?: string; host?: string } = {},
): Promise<{ id: string; host: string; password: string }> {
  const password = opts.password ?? 'Zx9KqT3mWp7Rb2NvLs8HdY4cFg6JtE5a';
  const r = await as(w.db, { kind: 'user', id: w.admin.id }, (tx) =>
    tx.query<{ id: string; host: string }>(
      `insert into public.routers (tenant_id, location_id, name, api_protocol, api_port, use_ssl, connector_id, host)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, '')) returning id, host`,
      [
        w.tenantId,
        w.locationId,
        opts.name ?? `r-${randomUUID().slice(0, 6)}`,
        opts.protocol ?? 'api',
        opts.protocol === 'rest' ? 443 : 8728,
        opts.protocol === 'rest',
        opts.connectorId ?? null,
        opts.host ?? null,
      ],
    ),
  );
  const row = r.rows[0]!;
  w.hostToRouter.set(row.host, row.id);
  if (opts.withCredentials !== false) {
    const { ciphertext, keyVersion } = w.keyring.encrypt(password, row.id);
    await w.db.query(
      `insert into public.router_credentials (router_id, tenant_id, username, password_ciphertext, key_version) values ($1, $2, 'hotzonex-api', $3, $4)`,
      [row.id, w.tenantId, ciphertext, keyVersion],
    );
    await w.db.query(`update public.routers set credentials_status = 'set' where id = $1`, [row.id]);
  }
  return { id: row.id, host: row.host, password };
}

/** Registers a connector, as its first heartbeat would. Routers reference one by id. */
export async function addConnector(w: World, connectorId: string): Promise<string> {
  await w.db.query(
    `insert into public.connector_status (connector_id, provider_mode, sealing_key_id, sealing_public_key, started_at, last_heartbeat_at)
     values ($1, 'mock', repeat('a', 16), '{"kty":"EC","crv":"P-256","x":"x","y":"y"}'::jsonb, now(), now())
     on conflict (connector_id) do nothing`,
    [connectorId],
  );
  return connectorId;
}

export async function enqueue(w: World, routerId: string, type: string, payload: Record<string, unknown> = {}, key = randomUUID()): Promise<string> {
  const [job] = await as(w.db, { kind: 'user', id: w.admin.id }, (tx) =>
    rpc<{ id: string }>(tx, 'enqueue_router_job', { p_router_id: routerId, p_type: type, p_idempotency_key: key, p_payload: payload }),
  );
  return job!.id;
}

export async function job(w: World, id: string): Promise<Record<string, unknown> & { status: string; attempts: number; deferrals: number; result: unknown; last_error_code: string | null; run_after: string }> {
  const r = await w.db.query(`select * from public.jobs where id = $1`, [id]);
  return r.rows[0] as never;
}

/** Claim + run everything currently runnable, until the queue is quiet. */
export async function runJobs(w: World, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const n = await w.runner.tick();
    await w.runner.drain();
    if (n === 0) break;
  }
}

export async function router(w: World, id: string): Promise<Record<string, unknown>> {
  return (await w.db.query(`select * from public.routers where id = $1`, [id])).rows[0] as Record<string, unknown>;
}

/** Make a pending job runnable now (skip its backoff), as if time had passed. */
export async function fastForward(w: World, jobId: string): Promise<void> {
  await w.db.query(`update public.jobs set run_after = now() - interval '1 second' where id = $1`, [jobId]);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
