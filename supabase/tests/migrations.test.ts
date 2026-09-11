import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTenant, createTestDb, createUser, rpc } from './harness.js';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

describe('migrations + seed', () => {
  it('seeds one tenant, three locations and three DEMO routers', async () => {
    const t = await db.query<{ n: number }>('select count(*)::int as n from public.tenants');
    const l = await db.query<{ name: string }>('select name from public.locations order by name');
    const r = await db.query<{ is_demo: boolean; wg_address: string; host: string; status: string }>(
      'select is_demo, wg_address, host, status from public.routers order by name',
    );
    expect(t.rows[0]?.n).toBe(1);
    expect(l.rows.map((x) => x.name)).toEqual(['Hotzonex Gorom', 'Hotzonex Juba', 'Hotzonex Lologo One']);
    expect(r.rows).toHaveLength(3);
    for (const row of r.rows) {
      expect(row.is_demo).toBe(true);
      expect(row.host).toBe(row.wg_address);
      expect(row.status).toBe('unknown');
    }
  });

  it('is idempotent: running the seed twice changes nothing', async () => {
    const before = await db.query<{ n: number }>('select count(*)::int as n from public.routers');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { SUPABASE_DIR } = await import('./harness.js');
    await db.exec(readFileSync(join(SUPABASE_DIR, 'seed.sql'), 'utf8'));
    const after = await db.query<{ n: number }>('select count(*)::int as n from public.routers');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('allocates unique tunnel addresses across tenants, skipping .0/.255 and the server', async () => {
    const tenant = await createTenant(db, 'alloc');
    const rows: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await db.query<{ wg_address: string }>(
        `insert into public.routers (tenant_id, name) values ($1, $2) returning wg_address`,
        [tenant, `alloc-${i}`],
      );
      rows.push(r.rows[0]!.wg_address);
    }
    expect(new Set(rows).size).toBe(5);
    expect(rows).not.toContain('10.77.0.1');
    for (const a of rows) expect(a).toMatch(/^10\.77\.\d+\.(?!0$|255$)\d+$/);
  });

  it('every job type in the registry matches the shared TypeScript registry', async () => {
    const { JOB_TYPES } = await import('@hotzonex/shared/jobs');
    const rows = await db.query<{
      type: string; destructive: boolean; defer_when_offline: boolean; max_attempts: number; user_enqueueable: boolean;
    }>('select type, destructive, defer_when_offline, max_attempts, user_enqueueable from public.job_types order by type');
    const fromTs = Object.entries(JOB_TYPES)
      .map(([type, p]) => ({
        type, destructive: p.destructive, defer_when_offline: p.deferWhenOffline, max_attempts: p.maxAttempts,
        user_enqueueable: p.userEnqueueable,
      }))
      .sort((a, b) => a.type.localeCompare(b.type));
    expect(rows.rows).toEqual(fromTs);
  });

  it('writes an audit entry, with actor, for an authenticated router rename', async () => {
    const tenant = await createTenant(db, 'audit');
    const admin = await createUser(db, { email: 'a@audit.test', role: 'ADMIN', tenantId: tenant });
    const r = await db.query<{ id: string }>(`insert into public.routers (tenant_id, name) values ($1, 'x') returning id`, [tenant]);
    const id = r.rows[0]!.id;
    await as(db, { kind: 'user', id: admin.id, headers: { 'x-forwarded-for': '41.79.1.2, 10.0.0.1', 'user-agent': 'vitest' } }, (tx) =>
      tx.query(`update public.routers set name = 'renamed' where id = $1`, [id]),
    );
    const log = await db.query<{ action: string; actor_email: string; before: unknown; after: unknown; ip: string; user_agent: string }>(
      `select action, actor_email, before, after, ip, user_agent from public.audit_logs where entity_id = $1 and action = 'router.updated'`,
      [id],
    );
    expect(log.rows[0]).toMatchObject({
      action: 'router.updated', actor_email: 'a@audit.test', before: { name: 'x' }, after: { name: 'renamed' }, ip: '41.79.1.2', user_agent: 'vitest',
    });
  });

  it('does not audit connector telemetry churn on routers', async () => {
    const tenant = await createTenant(db, 'churn');
    const r = await db.query<{ id: string }>(`insert into public.routers (tenant_id, name) values ($1, 'y') returning id`, [tenant]);
    const id = r.rows[0]!.id;
    const before = await db.query<{ n: number }>(`select count(*)::int n from public.audit_logs where entity_id = $1`, [id]);
    await as(db, { kind: 'service' }, (tx) => rpc(tx, 'connector_record_poll', {
      p_router_id: id, p_reachable: true, p_status: 'online', p_metrics: { cpu_load: 5, free_memory: 1, total_memory: 2, uptime_seconds: 3 },
    }));
    const after = await db.query<{ n: number }>(`select count(*)::int n from public.audit_logs where entity_id = $1`, [id]);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
