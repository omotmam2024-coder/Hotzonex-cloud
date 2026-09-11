/**
 * PGlite test harness: a real Postgres (WASM) with the Supabase shim and every
 * migration applied. Used by the RLS tests here and by the connector's
 * integration tests (via @hotzonex/db/testing).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_DIR = join(here, '..');
export const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

export type Queryable = PGlite | Transaction;

export async function createTestDb(opts: { seed?: boolean } = {}): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(readFileSync(join(here, 'supabase-shim.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }
  if (opts.seed) await db.exec(readFileSync(join(SUPABASE_DIR, 'seed.sql'), 'utf8'));
  return db;
}

export type Actor =
  | { kind: 'anon' }
  | { kind: 'user'; id: string; headers?: Record<string, string> }
  | { kind: 'service' }
  | { kind: 'postgres' };

/**
 * Run `fn` in a transaction as the given API role, the way PostgREST does:
 * SET LOCAL ROLE plus request.jwt.claims (and optionally request.headers).
 * The transaction commits unless `fn` throws.
 */
export async function as<T>(db: PGlite, actor: Actor, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (actor.kind === 'anon') {
      await tx.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else if (actor.kind === 'service') {
      await tx.exec(`set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
    } else if (actor.kind === 'user') {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: actor.id, role: 'authenticated' }),
      ]);
      if (actor.headers) {
        await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(actor.headers)]);
      }
      await tx.exec('set local role authenticated');
    }
    return fn(tx);
  });
}

/** Postgres error SQLSTATE, for assertions. */
export function sqlState(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function literalFor(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/**
 * Call a function the way supabase.rpc() does: named arguments, JSON for
 * objects, result rows back. Parameters are sent untyped so Postgres resolves
 * them against the function signature.
 */
export async function rpc<T = Record<string, unknown>>(q: Queryable, fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`bad function name ${fn}`);
  const keys = Object.keys(args);
  for (const k of keys) if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`bad argument name ${k}`);
  const list = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const result = await q.query<T>(`select * from public.${fn}(${list})`, keys.map((k) => literalFor(args[k])));
  return result.rows;
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
export interface UserFixture {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'TECHNICIAN' | 'RESELLER' | 'CUSTOMER';
  tenantId: string;
}

export async function createUser(db: Queryable, u: Omit<UserFixture, 'id'> & { id?: string }): Promise<UserFixture> {
  const id = u.id ?? (await db.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, '{"provisioned_by":"hotzonex-seed"}')`,
    [id, u.email],
  );
  await db.query(`insert into public.profiles (id, tenant_id, email, role) values ($1, $2, $3, $4)`, [id, u.tenantId, u.email, u.role]);
  return { id, email: u.email, role: u.role, tenantId: u.tenantId };
}

export async function createTenant(db: Queryable, slug: string): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into public.tenants (name, slug) values ($1, $2) returning id`, [`Tenant ${slug}`, slug]);
  return r.rows[0]!.id;
}

export interface RouterFixture {
  id: string;
  tenantId: string;
  wgAddress: string;
}

export async function createRouter(
  db: Queryable,
  tenantId: string,
  opts: { name?: string; locationId?: string | null; isDemo?: boolean; credentials?: boolean; protocol?: 'api' | 'api_ssl' | 'rest' } = {},
): Promise<RouterFixture> {
  const protocol = opts.protocol ?? 'api';
  const r = await db.query<{ id: string; wg_address: string }>(
    `insert into public.routers (tenant_id, location_id, name, api_protocol, api_port, use_ssl, is_demo)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, wg_address`,
    [tenantId, opts.locationId ?? null, opts.name ?? `router-${Math.random().toString(36).slice(2, 8)}`, protocol,
     protocol === 'rest' ? 443 : protocol === 'api_ssl' ? 8729 : 8728, protocol !== 'api', opts.isDemo ?? false],
  );
  const row = r.rows[0]!;
  if (opts.credentials) {
    await db.query(
      `insert into public.router_credentials (router_id, tenant_id, username, password_ciphertext, key_version)
       values ($1, $2, 'hotzonex-api', 'v1.AAAA.BBBB.CCCC', 1)`,
      [row.id, tenantId],
    );
    await db.query(`update public.routers set credentials_status = 'set' where id = $1`, [row.id]);
  }
  return { id: row.id, tenantId, wgAddress: row.wg_address };
}

export async function createLocation(db: Queryable, tenantId: string, name: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.locations (tenant_id, name, lat, lng) values ($1, $2, 4.85, 31.58) returning id`,
    [tenantId, name],
  );
  return r.rows[0]!.id;
}

/** A minimal valid sealed envelope shape (contents are opaque to the database). */
export function fakeEnvelope(): Record<string, string> {
  return {
    v: '1',
    kid: '0123456789abcdef',
    epk: 'B'.repeat(87),
    iv: 'C'.repeat(16),
    ct: 'D'.repeat(64),
  };
}
