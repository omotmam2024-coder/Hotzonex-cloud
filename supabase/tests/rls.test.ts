/**
 * Row Level Security, privileges and tenancy — run against real Postgres with
 * Supabase's permissive default grants, so only RLS/revokes stand between
 * tenants.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createLocation,
  createRouter,
  createTenant,
  createTestDb,
  createUser,
  fakeEnvelope,
  rpc,
  sqlState,
  type Actor,
  type RouterFixture,
  type UserFixture,
} from './harness.js';

let db: PGlite;
let tenantA: string;
let tenantB: string;
let adminA: UserFixture;
let techA: UserFixture;
let resellerA: UserFixture;
let customerA: UserFixture;
let adminB: UserFixture;
let superAdmin: UserFixture;
let routerA: RouterFixture;
let routerB: RouterFixture;

const user = (u: UserFixture): Actor => ({ kind: 'user', id: u.id });

async function seedRouterData(q: PGlite, r: RouterFixture, tenant: string): Promise<void> {
  await q.query(
    `insert into public.router_interfaces (tenant_id, router_id, mikrotik_id, name, type) values ($1, $2, '*1', 'ether1', 'ether')`,
    [tenant, r.id],
  );
  await q.query(
    `insert into public.hotspot_servers (tenant_id, router_id, mikrotik_id, name) values ($1, $2, '*1', 'hotspot1')`,
    [tenant, r.id],
  );
  await q.query(
    `insert into public.hotspot_profiles (tenant_id, router_id, mikrotik_id, name) values ($1, $2, '*1', 'default')`,
    [tenant, r.id],
  );
  await q.query(`insert into public.router_metrics (tenant_id, router_id, reachable, cpu_load) values ($1, $2, true, 5)`, [tenant, r.id]);
  await q.query(
    `insert into public.sync_drift (tenant_id, router_id, entity_type, field, message) values ($1, $2, 'router', 'identity', 'x')`,
    [tenant, r.id],
  );
  await q.query(
    `insert into public.router_credential_submissions (tenant_id, router_id, sealed) values ($1, $2, '{"v":1}')`,
    [tenant, r.id],
  );
  await q.query(
    `insert into public.jobs (tenant_id, router_id, type, idempotency_key) values ($1, $2, 'router.sync', $3)`,
    [tenant, r.id, `seed-${r.id}`],
  );
  await q.query(
    `insert into public.system_settings (tenant_id, key, value) values ($1, 'health_poll_interval_seconds', '300')`,
    [tenant],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  tenantA = await createTenant(db, 'tenant-a');
  tenantB = await createTenant(db, 'tenant-b');
  adminA = await createUser(db, { email: 'admin@a.test', role: 'ADMIN', tenantId: tenantA });
  techA = await createUser(db, { email: 'tech@a.test', role: 'TECHNICIAN', tenantId: tenantA });
  resellerA = await createUser(db, { email: 'reseller@a.test', role: 'RESELLER', tenantId: tenantA });
  customerA = await createUser(db, { email: 'customer@a.test', role: 'CUSTOMER', tenantId: tenantA });
  adminB = await createUser(db, { email: 'admin@b.test', role: 'ADMIN', tenantId: tenantB });
  superAdmin = await createUser(db, { email: 'root@hq.test', role: 'SUPER_ADMIN', tenantId: tenantA });
  await createLocation(db, tenantA, 'A-Site');
  await createLocation(db, tenantB, 'B-Site');
  routerA = await createRouter(db, tenantA, { name: 'router-a', credentials: true });
  routerB = await createRouter(db, tenantB, { name: 'router-b', credentials: true });
  await seedRouterData(db, routerA, tenantA);
  await seedRouterData(db, routerB, tenantB);
  await as(db, user(adminA), (tx) => rpc(tx, 'create_invite', { p_email: 'new@a.test', p_role: 'TECHNICIAN' }));
  await as(db, user(adminB), (tx) => rpc(tx, 'create_invite', { p_email: 'new@b.test', p_role: 'TECHNICIAN' }));
});

afterAll(async () => {
  await db.close();
});

/** Tables holding tenant data, with a harmless column to attempt updates on. */
const TENANT_TABLES: Array<{ table: string; column: string }> = [
  { table: 'profiles', column: 'full_name' },
  { table: 'invites', column: 'email' },
  { table: 'system_settings', column: 'value' },
  { table: 'locations', column: 'name' },
  { table: 'routers', column: 'name' },
  { table: 'router_interfaces', column: 'name' },
  { table: 'hotspot_servers', column: 'name' },
  { table: 'hotspot_profiles', column: 'name' },
  { table: 'router_metrics', column: 'reachable' },
  { table: 'sync_drift', column: 'message' },
  { table: 'router_credentials', column: 'username' },
  { table: 'router_credential_submissions', column: 'sealed' },
  { table: 'jobs', column: 'status' },
  { table: 'audit_logs', column: 'action' },
];

async function countAsPostgres(table: string, tenant: string): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where tenant_id = $1`, [tenant]);
  return r.rows[0]?.n ?? 0;
}

/** Run a statement; return affected/selected row count, or 'denied' on a privilege/RLS error. */
async function attempt(actor: Actor, fn: (tx: Transaction) => Promise<{ affectedRows?: number; rows: unknown[] }>): Promise<number | 'denied'> {
  try {
    return await as(db, actor, async (tx) => {
      const r = await fn(tx);
      // PGlite reports affectedRows = 0 for SELECT, so prefer returned rows when there are any.
      return r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0);
    });
  } catch (error) {
    if (['42501', '42P01'].includes(sqlState(error) ?? '')) return 'denied';
    throw error;
  }
}

describe('tenant isolation — tenant A cannot read, update, or delete tenant B rows', () => {
  for (const { table, column } of TENANT_TABLES) {
    describe(table, () => {
      for (const who of ['adminA', 'techA', 'resellerA', 'customerA'] as const) {
        it(`${who}: read / update / delete of tenant B rows all fail`, async () => {
          const actor = user({ adminA, techA, resellerA, customerA }[who]);
          const before = await countAsPostgres(table, tenantB);
          expect(before).toBeGreaterThan(0);

          const read = await attempt(actor, (tx) => tx.query(`select * from public.${table} where tenant_id = $1`, [tenantB]));
          expect(read === 'denied' || read === 0).toBe(true);

          const upd = await attempt(actor, (tx) =>
            tx.query(`update public.${table} set ${column} = ${column} where tenant_id = $1`, [tenantB]),
          );
          expect(upd === 'denied' || upd === 0).toBe(true);

          const del = await attempt(actor, (tx) => tx.query(`delete from public.${table} where tenant_id = $1`, [tenantB]));
          expect(del === 'denied' || del === 0).toBe(true);

          expect(await countAsPostgres(table, tenantB)).toBe(before);
        });
      }
    });
  }

  it('tenants: A cannot see or rename tenant B', async () => {
    const read = await attempt(user(adminA), (tx) => tx.query(`select * from public.tenants where id = $1`, [tenantB]));
    expect(read).toBe(0);
    const upd = await attempt(user(adminA), (tx) => tx.query(`update public.tenants set name = 'pwned' where id = $1`, [tenantB]));
    expect(upd === 'denied' || upd === 0).toBe(true);
    const r = await db.query<{ name: string }>(`select name from public.tenants where id = $1`, [tenantB]);
    expect(r.rows[0]?.name).toBe('Tenant tenant-b');
  });

  it('invite_tokens: no API role can read any token hash', async () => {
    for (const actor of [user(adminA), user(superAdmin), { kind: 'anon' } as Actor]) {
      const read = await attempt(actor, (tx) => tx.query(`select * from public.invite_tokens`));
      expect(read === 'denied' || read === 0).toBe(true);
    }
  });

  it('positive control: A staff do see their own tenant rows', async () => {
    for (const table of ['locations', 'routers', 'router_interfaces', 'hotspot_servers', 'router_metrics', 'jobs', 'audit_logs', 'system_settings']) {
      const n = await attempt(user(techA), (tx) => tx.query(`select * from public.${table} where tenant_id = $1`, [tenantA]));
      expect(n, table).not.toBe('denied');
      expect(n as number, table).toBeGreaterThan(0);
    }
  });

  it('SUPER_ADMIN sees every tenant', async () => {
    const n = await attempt(user(superAdmin), (tx) => tx.query(`select * from public.routers where tenant_id in ($1, $2)`, [tenantA, tenantB]));
    expect(n).toBe(2);
  });

  it('A cannot create rows inside tenant B', async () => {
    const loc = await attempt(user(adminA), (tx) =>
      tx.query(`insert into public.locations (tenant_id, name) values ($1, 'sneaky')`, [tenantB]),
    );
    expect(loc).toBe('denied');
    const rtr = await attempt(user(adminA), (tx) =>
      tx.query(`insert into public.routers (tenant_id, name) values ($1, 'sneaky')`, [tenantB]),
    );
    expect(rtr).toBe('denied');
    await expect(
      as(db, user(adminA), (tx) => rpc(tx, 'enqueue_router_job', { p_router_id: routerB.id, p_type: 'router.sync', p_idempotency_key: 'cross-tenant-1' })),
    ).rejects.toThrow(/Router not found/);
    await expect(
      as(db, user(adminA), (tx) => rpc(tx, 'submit_router_credentials', { p_router_id: routerB.id, p_sealed: fakeEnvelope(), p_idempotency_key: 'cross-tenant-2' })),
    ).rejects.toThrow(/Router not found/);
  });

  it('positive control: A can submit a well-formed envelope for its own router, and malformed ones are refused', async () => {
    const [job] = await as(db, user(techA), (tx) =>
      rpc<{ type: string; status: string }>(tx, 'submit_router_credentials', { p_router_id: routerA.id, p_sealed: fakeEnvelope(), p_idempotency_key: 'own-tenant-1' }),
    );
    expect(job).toMatchObject({ type: 'router.ingest_credentials', status: 'pending' });
    await expect(
      as(db, user(techA), (tx) => rpc(tx, 'submit_router_credentials', { p_router_id: routerA.id, p_sealed: { ...fakeEnvelope(), password: 'plain' }, p_idempotency_key: 'own-tenant-2' })),
    ).rejects.toThrow(/malformed/);
  });
});

describe('roles', () => {
  it('TECHNICIAN cannot delete a router; ADMIN can', async () => {
    const extra = await createRouter(db, tenantA, { name: 'deletable' });
    const byTech = await attempt(user(techA), (tx) => tx.query(`delete from public.routers where id = $1`, [extra.id]));
    expect(byTech).toBe(0);
    expect((await db.query(`select 1 from public.routers where id = $1`, [extra.id])).rows).toHaveLength(1);
    const byAdmin = await attempt(user(adminA), (tx) => tx.query(`delete from public.routers where id = $1`, [extra.id]));
    expect(byAdmin).toBe(1);
  });

  it('TECHNICIAN can create and edit routers but not locations or settings', async () => {
    expect(await attempt(user(techA), (tx) => tx.query(`insert into public.routers (tenant_id, name) values ($1, 'by-tech')`, [tenantA]))).toBe(1);
    expect(await attempt(user(techA), (tx) => tx.query(`update public.routers set notes = 'n' where id = $1`, [routerA.id]))).toBe(1);
    expect(await attempt(user(techA), (tx) => tx.query(`insert into public.locations (tenant_id, name) values ($1, 't')`, [tenantA]))).toBe('denied');
    expect(await attempt(user(techA), (tx) => tx.query(`update public.locations set name = name where tenant_id = $1`, [tenantA]))).toBe(0);
    expect(await attempt(user(techA), (tx) => tx.query(`update public.system_settings set value = '600' where tenant_id = $1`, [tenantA]))).toBe(0);
  });

  it('RESELLER and CUSTOMER have no Phase 1 access to network data', async () => {
    for (const u of [resellerA, customerA]) {
      for (const table of ['routers', 'locations', 'jobs', 'audit_logs']) {
        expect(await attempt(user(u), (tx) => tx.query(`select * from public.${table}`)), `${u.role} ${table}`).toBe(0);
      }
      const own = await attempt(user(u), (tx) => tx.query(`select * from public.profiles where id = $1`, [u.id]));
      expect(own).toBe(1);
    }
  });

  it('users cannot write connector-owned router columns (status, telemetry, tunnel, credentials state, demo flag)', async () => {
    for (const col of ["status = 'online'", 'last_seen_at = now()', "host = '8.8.8.8'", "wg_address = '10.77.9.9'",
                       "credentials_status = 'set'", 'is_demo = true', 'tenant_id = tenant_id']) {
      expect(await attempt(user(adminA), (tx) => tx.query(`update public.routers set ${col} where id = $1`, [routerA.id])), col).toBe('denied');
    }
  });

  it('users cannot insert, update or delete jobs directly', async () => {
    expect(await attempt(user(adminA), (tx) =>
      tx.query(`insert into public.jobs (tenant_id, router_id, type, idempotency_key) values ($1, $2, 'router.sync', 'direct-1')`, [tenantA, routerA.id]),
    )).toBe('denied');
    expect(await attempt(user(adminA), (tx) => tx.query(`update public.jobs set status = 'succeeded' where tenant_id = $1`, [tenantA]))).toBe('denied');
    expect(await attempt(user(adminA), (tx) => tx.query(`delete from public.jobs where tenant_id = $1`, [tenantA]))).toBe('denied');
  });

  it('a suspended user loses access immediately', async () => {
    const temp = await createUser(db, { email: 'temp@a.test', role: 'TECHNICIAN', tenantId: tenantA });
    expect(await attempt(user(temp), (tx) => tx.query(`select * from public.routers`))).toBeGreaterThan(0);
    await as(db, user(adminA), (tx) => rpc(tx, 'update_member', { p_profile_id: temp.id, p_role: 'TECHNICIAN', p_status: 'suspended' }));
    expect(await attempt(user(temp), (tx) => tx.query(`select * from public.routers`))).toBe(0);
  });

  it('an admin cannot promote anyone to SUPER_ADMIN or change their own role', async () => {
    await expect(as(db, user(adminA), (tx) => rpc(tx, 'update_member', { p_profile_id: techA.id, p_role: 'SUPER_ADMIN', p_status: 'active' }))).rejects.toThrow(/super administrator/);
    await expect(as(db, user(adminA), (tx) => rpc(tx, 'update_member', { p_profile_id: adminA.id, p_role: 'TECHNICIAN', p_status: 'active' }))).rejects.toThrow(/your own/);
    await expect(as(db, user(adminB), (tx) => rpc(tx, 'update_member', { p_profile_id: techA.id, p_role: 'ADMIN', p_status: 'active' }))).rejects.toThrow(/not found/);
  });
});

describe('credentials are unreachable from every API role', () => {
  it('anon cannot read router_credentials at all', async () => {
    expect(await attempt({ kind: 'anon' }, (tx) => tx.query(`select * from public.router_credentials`))).toBe('denied');
  });

  it('no authenticated role (not even SUPER_ADMIN) can read credentials or submissions', async () => {
    for (const u of [adminA, techA, superAdmin]) {
      expect(await attempt(user(u), (tx) => tx.query(`select * from public.router_credentials`))).toBe('denied');
      expect(await attempt(user(u), (tx) => tx.query(`select * from public.router_credential_submissions`))).toBe('denied');
    }
  });

  it('connector functions that return ciphertext are not executable by users', async () => {
    const r = await attempt(user(superAdmin), (tx) => rpc(tx, 'connector_get_router', { p_router_id: routerA.id }).then((rows) => ({ rows })));
    expect(r).toBe('denied');
  });
});

describe('function privileges', () => {
  it('only an explicit allow-list of public functions is callable by anon / authenticated', async () => {
    const rows = await db.query<{ name: string; anon: boolean; authed: boolean }>(`
      select p.proname as name,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authed
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype order by 1`);
    const anon = rows.rows.filter((r) => r.anon).map((r) => r.name);
    const authed = rows.rows.filter((r) => r.authed).map((r) => r.name);
    expect(anon).toEqual(['get_invite']);
    expect(authed).toEqual([
      'create_invite', 'enqueue_router_job', 'get_invite', 'record_auth_event', 'resolve_drift', 'revoke_invite',
      'router_uptime_buckets', 'submit_router_credentials', 'update_member',
    ]);
  });
});

describe('audit log immutability', () => {
  it('no one can update or delete audit entries — not users, not the service role', async () => {
    expect(await attempt(user(adminA), (tx) => tx.query(`update public.audit_logs set action = 'x.y' where tenant_id = $1`, [tenantA]))).toBe('denied');
    expect(await attempt(user(adminA), (tx) => tx.query(`delete from public.audit_logs where tenant_id = $1`, [tenantA]))).toBe('denied');
    expect(await attempt({ kind: 'service' }, (tx) => tx.query(`delete from public.audit_logs`))).toBe('denied');
    await expect(db.query(`delete from public.audit_logs`)).rejects.toThrow(/immutable/);
    await expect(db.query(`update public.audit_logs set action = 'x.y'`)).rejects.toThrow(/immutable/);
  });
});

describe('invite-only sign-up', () => {
  async function signUp(email: string, meta: Record<string, unknown>): Promise<string> {
    const r = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [email, JSON.stringify(meta)],
    );
    return r.rows[0]!.id;
  }

  it('creates a profile in the inviting tenant with the invited role, once', async () => {
    const [invite] = await as(db, user(adminA), (tx) => rpc<{ invite_id: string; token: string }>(tx, 'create_invite', { p_email: 'Joiner@A.test', p_role: 'TECHNICIAN' }));
    const lookup = await as(db, { kind: 'anon' }, (tx) => rpc<{ state: string; email: string }>(tx, 'get_invite', { p_token: invite!.token }));
    expect(lookup[0]).toMatchObject({ state: 'valid', email: 'joiner@a.test' });

    const id = await signUp('joiner@a.test', { invite_token: invite!.token, full_name: 'Joy Iner' });
    const p = await db.query<{ tenant_id: string; role: string; full_name: string }>(`select tenant_id, role, full_name from public.profiles where id = $1`, [id]);
    expect(p.rows[0]).toEqual({ tenant_id: tenantA, role: 'TECHNICIAN', full_name: 'Joy Iner' });

    await expect(signUp('joiner2@a.test', { invite_token: invite!.token })).rejects.toThrow(/invalid, expired/);
    const after = await as(db, { kind: 'anon' }, (tx) => rpc<{ state: string }>(tx, 'get_invite', { p_token: invite!.token }));
    expect(after[0]?.state).toBe('not_found');
  });

  it('rejects sign-up without a token, with a wrong email, or with a revoked invite', async () => {
    await expect(signUp('nobody@x.test', {})).rejects.toThrow(/invite-only/);
    const [inv] = await as(db, user(adminA), (tx) => rpc<{ invite_id: string; token: string }>(tx, 'create_invite', { p_email: 'right@a.test', p_role: 'ADMIN' }));
    await expect(signUp('wrong@a.test', { invite_token: inv!.token })).rejects.toThrow(/different email/);
    await as(db, user(adminA), (tx) => rpc(tx, 'revoke_invite', { p_invite_id: inv!.invite_id }));
    await expect(signUp('right@a.test', { invite_token: inv!.token })).rejects.toThrow(/invalid, expired/);
  });

  it('accepts an admin-API user whose app_metadata is set after the insert (Supabase Auth createUser)', async () => {
    // Supabase Auth inserts the row, then sets app_metadata in a second statement of the same transaction.
    const id = await db.transaction(async (tx) => {
      const r = await tx.query<{ id: string }>(`insert into auth.users (email) values ('seeded@hq.test') returning id`);
      const uid = r.rows[0]!.id;
      await tx.query(`update auth.users set raw_app_meta_data = '{"provisioned_by":"hotzonex-seed"}' where id = $1`, [uid]);
      return uid;
    });
    expect((await db.query(`select 1 from auth.users where id = $1`, [id])).rows).toHaveLength(1);
    // The seed script creates the profile itself; the trigger must not.
    expect((await db.query(`select 1 from public.profiles where id = $1`, [id])).rows).toHaveLength(0);

    // Without the marker the same two-step write is still rejected, and nothing is left behind.
    await expect(
      db.transaction(async (tx) => {
        await tx.query(`insert into auth.users (email) values ('sneaky@hq.test')`);
        await tx.query(`update auth.users set raw_app_meta_data = '{"provider":"email"}' where email = 'sneaky@hq.test'`);
      }),
    ).rejects.toThrow(/invite-only/);
    expect((await db.query(`select 1 from auth.users where email = 'sneaky@hq.test'`)).rows).toHaveLength(0);
  });

  it('technicians cannot invite; invites can only grant ADMIN or TECHNICIAN', async () => {
    await expect(as(db, user(techA), (tx) => rpc(tx, 'create_invite', { p_email: 'x@a.test', p_role: 'TECHNICIAN' }))).rejects.toThrow(/Only an administrator/);
    await expect(as(db, user(adminA), (tx) => rpc(tx, 'create_invite', { p_email: 'x@a.test', p_role: 'SUPER_ADMIN' }))).rejects.toThrow(/Admin or Technician/);
  });
});

describe('login / logout audit', () => {
  it('records auth.login and auth.logout server-side from auth.sessions', async () => {
    const s = await db.query<{ id: string }>(
      `insert into auth.sessions (user_id, ip, user_agent) values ($1, '41.79.20.5', 'Mozilla/5.0 test') returning id`,
      [adminA.id],
    );
    await db.query(`delete from auth.sessions where id = $1`, [s.rows[0]!.id]);
    const log = await db.query<{ action: string; ip: string; user_agent: string; actor_email: string }>(
      `select action, ip, user_agent, actor_email from public.audit_logs where entity_id = $1 and action like 'auth.%' order by id`,
      [adminA.id],
    );
    expect(log.rows).toEqual([
      { action: 'auth.login', ip: '41.79.20.5', user_agent: 'Mozilla/5.0 test', actor_email: 'admin@a.test' },
      { action: 'auth.logout', ip: '41.79.20.5', user_agent: 'Mozilla/5.0 test', actor_email: 'admin@a.test' },
    ]);
  });

  it('client fallback is a no-op while the server triggers exist (no duplicates, nothing to forge)', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int n from public.audit_logs where entity_id = $1 and action like 'auth.%'`, [techA.id]);
    await as(db, user(techA), (tx) => rpc(tx, 'record_auth_event', { p_event: 'login' }));
    const after = await db.query<{ n: number }>(`select count(*)::int n from public.audit_logs where entity_id = $1 and action like 'auth.%'`, [techA.id]);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    await expect(as(db, user(techA), (tx) => rpc(tx, 'record_auth_event', { p_event: 'router.deleted' }))).rejects.toThrow(/Unknown event/);
  });

  it('where the triggers cannot be installed, the fallback records the caller’s own sign-in', async () => {
    const isolated = await createTestDb();
    try {
      const t = await createTenant(isolated, 'fallback');
      const u = await createUser(isolated, { email: 'fb@x.test', role: 'ADMIN', tenantId: t });
      await isolated.exec('drop trigger on_auth_session_created on auth.sessions; drop trigger on_auth_session_deleted on auth.sessions;');
      await as(isolated, { kind: 'user', id: u.id, headers: { 'x-forwarded-for': '41.79.1.1' } }, (tx) => rpc(tx, 'record_auth_event', { p_event: 'login' }));
      const log = await isolated.query<{ action: string; actor_email: string; entity_id: string; ip: string }>(
        `select action, actor_email, entity_id, ip from public.audit_logs where action like 'auth.%'`,
      );
      expect(log.rows).toEqual([{ action: 'auth.login', actor_email: 'fb@x.test', entity_id: u.id, ip: '41.79.1.1' }]);
    } finally {
      await isolated.close();
    }
  });
});
