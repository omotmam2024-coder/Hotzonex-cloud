/**
 * Integration: real SQL (PGlite + migrations) + production connector code +
 * MockMikrotikProvider. No physical router involved.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_FAILURE_PRESETS } from '@hotzonex/mikrotik';
import { as, rpc } from '@hotzonex/db/testing';
import { JobFailure } from '../src/jobs/context.js';
import type { RegisteredJob } from '../src/jobs/runner.js';
import { DEFAULT_REGISTRY } from '../src/jobs/runner.js';
import { addConnector, addRouter, createWorld, enqueue, fastForward, job, router, runJobs, sleep, type World } from './world.js';

let w: World;
afterEach(async () => {
  await w?.close();
});

async function auditActions(routerId: string): Promise<string[]> {
  const r = await w.db.query<{ action: string }>(`select action from public.audit_logs where entity_id = $1 order by id`, [routerId]);
  return r.rows.map((x) => x.action);
}

describe('connection test', () => {
  it('succeeds: stores identity/board/version/resources, marks the router ONLINE, audits request + result', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    const id = await enqueue(w, r.id, 'router.test_connection');
    await runJobs(w);

    const j = await job(w, id);
    expect(j.status).toBe('succeeded');
    const fixtures = w.providers[0]!.fixtures;
    expect(j.result).toMatchObject({
      identity: fixtures.identity,
      routerOsVersion: fixtures.version,
      boardName: fixtures.boardName,
      architecture: fixtures.architecture,
    });
    const row = await router(w, r.id);
    expect(row).toMatchObject({ status: 'online', routeros_version: fixtures.version, board_name: fixtures.boardName, architecture: fixtures.architecture });
    expect(row['last_seen_at']).not.toBeNull();
    expect(row['cpu_load']).not.toBeNull();
    expect(row['uptime_seconds']).not.toBeNull();
    expect(await auditActions(r.id)).toEqual(
      expect.arrayContaining(['router.created', 'router.test_connection.requested', 'router.test_connection.succeeded']),
    );
  });

  it.each([
    ['auth failure', MOCK_FAILURE_PRESETS.authFailed, 'AUTH_FAILED'],
    ['API disabled', MOCK_FAILURE_PRESETS.apiDisabled, 'API_DISABLED'],
    ['timeout', MOCK_FAILURE_PRESETS.timeout, 'TIMEOUT'],
  ] as const)('%s → failed with a typed code, not retried', async (_label, failure, code) => {
    w = await createWorld({ timeoutMs: 50 });
    const r = await addRouter(w);
    // The tunnel was up an hour ago; the router has since gone quiet.
    await w.db.query(`update public.routers set wg_last_handshake_at = now() - interval '1 hour' where id = $1`, [r.id]);
    w.behaviors.set(r.id, { connectFailure: failure });
    const id = await enqueue(w, r.id, 'router.test_connection');
    await runJobs(w);
    const j = await job(w, id);
    expect(j).toMatchObject({ status: 'failed', last_error_code: code, attempts: 1 });
    expect(await auditActions(r.id)).toContain('router.test_connection.failed');
  });

  it('a timeout while the tunnel handshake is fresh is reported as PORT_BLOCKED', async () => {
    w = await createWorld({ timeoutMs: 50 });
    const r = await addRouter(w);
    await w.db.query(`update public.routers set wg_last_handshake_at = now() where id = $1`, [r.id]);
    w.behaviors.set(r.id, { connectFailure: { kind: 'error', code: 'TIMEOUT', stage: 'connect' } });
    const id = await enqueue(w, r.id, 'router.test_connection');
    await runJobs(w);
    expect(await job(w, id)).toMatchObject({ status: 'failed', last_error_code: 'PORT_BLOCKED' });
  });

  it('a router that never completed a WireGuard handshake is UNREACHABLE with that reason', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    w.behaviors.set(r.id, { connectFailure: MOCK_FAILURE_PRESETS.offline });
    const id = await enqueue(w, r.id, 'router.test_connection');
    await runJobs(w);
    const j = await job(w, id);
    expect(j).toMatchObject({ status: 'failed', last_error_code: 'UNREACHABLE' });
    expect(j['last_error']).toMatch(/WireGuard handshake/);
  });

  it('fails fast with NO_CREDENTIALS when none are stored', async () => {
    w = await createWorld();
    const r = await addRouter(w, { withCredentials: false });
    await w.db.query(`update public.routers set credentials_status = 'pending' where id = $1`, [r.id]);
    const id = await enqueue(w, r.id, 'router.test_connection');
    await runJobs(w, 1);
    // Credentials still being stored → wait, don't fail.
    expect(await job(w, id)).toMatchObject({ status: 'pending', last_error_code: 'NO_CREDENTIALS', attempts: 0 });
    await w.db.query(`update public.routers set credentials_status = 'not_set' where id = $1`, [r.id]);
    await fastForward(w, id);
    await runJobs(w);
    expect(await job(w, id)).toMatchObject({ status: 'failed', last_error_code: 'NO_CREDENTIALS' });
  });
});

describe('permissions test', () => {
  it('reports required vs granted policies and which reads work', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    const id = await enqueue(w, r.id, 'router.test_permissions');
    await runJobs(w);
    const j = await job(w, id);
    expect(j.status).toBe('succeeded');
    expect(j.result).toMatchObject({ missing: [], excess: [], required: ['read', 'write', 'api', 'test'] });
    expect((j.result as { checks: Array<{ ok: boolean }> }).checks.every((c) => c.ok)).toBe(true);
  });

  it('flags a missing policy and a failing read without failing the job', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    w.mockOptions.fixtures = { user: { group: 'full', policies: ['read', 'api', 'policy', 'ftp'] } };
    w.behaviors.set(r.id, { methodFailures: { getHotspotServers: MOCK_FAILURE_PRESETS.permissionDenied } });
    const id = await enqueue(w, r.id, 'router.test_permissions');
    await runJobs(w);
    const result = (await job(w, id)).result as { missing: string[]; excess: string[]; checks: Array<{ operation: string; ok: boolean; errorCode: string | null }> };
    expect(result.missing).toEqual(['write', 'test']);
    expect(result.excess).toEqual(['policy', 'ftp']);
    expect(result.checks.find((c) => c.operation === 'read hotspot servers')).toMatchObject({ ok: false, errorCode: 'PERMISSION_DENIED' });
  });
});

describe('discovery & sync', () => {
  it('discovers identity, version, interfaces, hotspot servers and profiles', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    const id = await enqueue(w, r.id, 'router.sync');
    await runJobs(w);
    const j = await job(w, id);
    expect(j.status).toBe('succeeded');
    const f = w.providers[0]!.fixtures;
    const row = await router(w, r.id);
    expect(row).toMatchObject({ identity: f.identity, routeros_version: f.version, board_name: f.boardName, architecture: f.architecture });
    expect(row['discovered_at']).not.toBeNull();
    const servers = await w.db.query<{ mikrotik_id: string; name: string }>(`select mikrotik_id, name from public.hotspot_servers where router_id = $1 order by mikrotik_id`, [r.id]);
    const profiles = await w.db.query<{ name: string }>(`select name from public.hotspot_profiles where router_id = $1 order by mikrotik_id`, [r.id]);
    const ifaces = await w.db.query(`select 1 from public.router_interfaces where router_id = $1`, [r.id]);
    expect(servers.rows.map((s) => s.name)).toEqual(f.hotspotServers.map((s) => s.name));
    expect(profiles.rows.map((p) => p.name)).toEqual(f.hotspotProfiles.map((p) => p.name));
    expect(ifaces.rows).toHaveLength(f.interfaces.length);
    expect(j.result).toMatchObject({ interfaces: { added: f.interfaces.length }, hotspot_servers: { added: f.hotspotServers.length } });
    expect(await auditActions(r.id)).toContain('router.sync.succeeded');
  });

  it('is read-only against the router: only read methods are ever called', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    await enqueue(w, r.id, 'router.sync');
    await runJobs(w);
    const READS = new Set(['connect', 'testConnection', 'getSystemResource', 'getIdentity', 'getRouterOsVersion', 'getInterfaces',
      'getIpAddresses', 'getHotspotServers', 'getHotspotProfiles', 'getHotspotUsers', 'getActiveHotspotUsers', 'getLogs',
      'getSystemHealth', 'getCurrentUserPolicies']);
    const calls = w.providers.flatMap((p) => p.calls);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(READS.has(c)).toBe(true);
  });

  it('is non-destructive in Hotzonex too: items gone from the router are marked removed, never deleted, and drift is recorded', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    await enqueue(w, r.id, 'router.sync');
    await runJobs(w);
    const selected = await w.db.query<{ id: string }>(`select id from public.hotspot_servers where router_id = $1 and mikrotik_id = '*1'`, [r.id]);
    await as(w.db, { kind: 'user', id: w.admin.id }, (tx) =>
      tx.query(`update public.routers set hotspot_server_id = $1 where id = $2`, [selected.rows[0]!.id, r.id]),
    );

    // Someone deletes hotspot1 on the router; the next sync sees an empty server list.
    const summary = await w.store.applySync(r.id, { interfaces: [], hotspot_servers: [], hotspot_profiles: [] });
    expect(summary.hotspot_servers.removed).toBeGreaterThanOrEqual(1);
    const kept = await w.db.query<{ removed_at: string | null }>(`select removed_at from public.hotspot_servers where id = $1`, [selected.rows[0]!.id]);
    expect(kept.rows[0]?.removed_at).not.toBeNull();
    const r2 = await router(w, r.id);
    expect(r2['hotspot_server_id']).toBe(selected.rows[0]!.id);
    const drift = await w.db.query<{ message: string; resolved_at: string | null }>(`select message, resolved_at from public.sync_drift where router_id = $1`, [r.id]);
    expect(drift.rows).toHaveLength(1);
    expect(drift.rows[0]?.message).toMatch(/no longer exists on the router/);

    // The server reappears: the mirror restores it, but drift stays open for a human to acknowledge.
    await enqueue(w, r.id, 'router.sync');
    await runJobs(w);
    const back = await w.db.query<{ removed_at: string | null }>(`select removed_at from public.hotspot_servers where id = $1`, [selected.rows[0]!.id]);
    expect(back.rows[0]?.removed_at).toBeNull();
    const still = await w.db.query<{ resolved_at: string | null }>(`select resolved_at from public.sync_drift where router_id = $1`, [r.id]);
    expect(still.rows[0]?.resolved_at).toBeNull();
  });

  it('a connector only takes work for routers it can reach', async () => {
    // Two sites, two networks, two connectors — and the same address at both,
    // because every MikroTik ships as 192.168.88.1.
    w = await createWorld();
    await addConnector(w, 'site-juba');
    await addConnector(w, 'site-gorom');
    const juba = await addRouter(w, { name: 'Juba Market', connectorId: 'site-juba', host: '192.168.88.1' });
    const gorom = await addRouter(w, { name: 'Gorom', connectorId: 'site-gorom', host: '192.168.88.1' });
    const unassigned = await addRouter(w, { name: 'Bench' });

    const jubaJob = await enqueue(w, juba.id, 'router.sync');
    const goromJob = await enqueue(w, gorom.id, 'router.sync');
    const benchJob = await enqueue(w, unassigned.id, 'router.sync');

    // Juba's connector must not touch Gorom's router, however loudly it asks.
    const claimed = await w.store.claimJobs('site-juba', 50, 60);
    const ids = claimed.map((j) => j.id);
    expect(ids).toContain(jubaJob);
    expect(ids).not.toContain(goromJob);
    // A router assigned to nobody is still everyone's job, so a single-connector
    // install keeps working exactly as before.
    expect(ids).toContain(benchJob);

    // Gorom's own connector picks up what was left for it.
    const other = await w.store.claimJobs('site-gorom', 50, 60);
    expect(other.map((j) => j.id)).toEqual([goromJob]);
  });

  it('enables remote access on a local router and hands it to the tunnel connector', async () => {
    w = await createWorld();
    await addConnector(w, 'site-juba');
    // The VPS connector is the one that publishes an endpoint to dial.
    await addConnector(w, 'vps');
    await w.db.query(
      `update public.connector_status
          set wg_server_public_key = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm8=',
              wg_endpoint = 'wg.hotzonex.com:51820', wg_server_address = '10.77.0.1'
        where connector_id = 'vps'`,
    );
    // The site connector is the one running these jobs: it is on the router's LAN.
    await addConnector(w, 'test-connector');
    const r = await addRouter(w, { name: 'Juba Market', connectorId: 'test-connector', host: '192.168.88.1' });
    const before = await router(w, r.id);
    expect(before).toMatchObject({ host: '192.168.88.1', wg_public_key: null, connector_id: 'test-connector' });

    const id = await enqueue(w, r.id, 'router.enable_remote');
    await runJobs(w);

    const j = await job(w, id);
    expect(j.last_error ?? j.status).toBe('succeeded');
    const result = j.result as { publicKey: string; address: string; connectorId: string };
    // A tunnel address was allocated when the router was created; this is where it starts being used.
    expect(result.address).toBe(before['wg_address']);
    expect(result.connectorId).toBe('vps');

    const after = await router(w, r.id);
    expect(after).toMatchObject({
      host: before['wg_address'],
      wg_public_key: result.publicKey,
      // The site connector cannot reach a tunnel address; the VPS one takes over.
      connector_id: 'vps',
    });

    // The hand-over is real: the site connector is on the LAN and cannot reach a
    // tunnel address, so from now on it must not pick up work for this router.
    const next = await enqueue(w, r.id, 'router.sync');
    await runJobs(w);
    expect((await job(w, next)).status).toBe('pending');
    const claimedByTunnel = await w.store.claimJobs('vps', 10, 60);
    expect(claimedByTunnel.map((c) => c.id)).toContain(next);
  });

  it('refuses to enable remote access when no connector publishes an endpoint', async () => {
    w = await createWorld();
    const r = await addRouter(w, { name: 'Nowhere', host: '192.168.88.1' });
    const id = await enqueue(w, r.id, 'router.enable_remote');
    // Recoverable by starting the VPS connector, so it retries before giving up.
    for (let i = 0; i < 4; i++) {
      await runJobs(w);
      await fastForward(w, id);
    }
    const j = await job(w, id);
    expect(j.status).toBe('dead');
    expect(j.last_error).toMatch(/nothing to dial/i);
    // The router keeps its local address rather than being stranded on a tunnel that does not exist.
    expect(await router(w, r.id)).toMatchObject({ host: '192.168.88.1', wg_public_key: null });
  });

  it('a connector only polls the routers it is responsible for', async () => {
    w = await createWorld();
    await addConnector(w, 'site-juba');
    await addConnector(w, 'site-gorom');
    const juba = await addRouter(w, { name: 'Juba Health', connectorId: 'site-juba' });
    const gorom = await addRouter(w, { name: 'Gorom Health', connectorId: 'site-gorom' });
    const unassigned = await addRouter(w, { name: 'Bench Health' });

    const due = await w.store.routersDue(300, 500, 'site-juba');
    const ids = due.map((r) => r.id);
    expect(ids).toContain(juba.id);
    expect(ids).toContain(unassigned.id);
    expect(ids).not.toContain(gorom.id);
  });

  it('is idempotent: re-running an abandoned (claimed, never finished) sync does not duplicate anything', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    const id = await enqueue(w, r.id, 'router.sync');
    // A connector claims and starts the job, then crashes mid-flight.
    await w.store.claimJobs('crashed-connector', 10, 30);
    await w.store.startJob(id, 'crashed-connector');
    await w.store.applySync(r.id, {
      interfaces: [{ mikrotik_id: '*1', name: 'ether1', type: 'ether' }],
      hotspot_servers: [],
      hotspot_profiles: [],
    });
    // Lease expires; this connector reclaims and runs it to completion.
    await w.db.query(`update public.jobs set claimed_at = now() - interval '10 minutes' where id = $1`, [id]);
    await runJobs(w);
    const j = await job(w, id);
    expect(j).toMatchObject({ status: 'succeeded', attempts: 2, claimed_by: 'test-connector' });
    const dup = await w.db.query<{ n: number }>(`select count(*)::int n from public.router_interfaces where router_id = $1 group by mikrotik_id having count(*) > 1`, [r.id]);
    expect(dup.rows).toHaveLength(0);
  });

  it('enqueue is idempotent by key, and coalesces duplicate pending syncs', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    const key = randomUUID();
    const a = await enqueue(w, r.id, 'router.sync', {}, key);
    const b = await enqueue(w, r.id, 'router.sync', {}, key);
    const c = await enqueue(w, r.id, 'router.sync');
    expect(b).toBe(a);
    expect(c).toBe(a);
    await expect(enqueue(w, r.id, 'router.test_connection', {}, key)).rejects.toThrow(/different action/);
  });
});

describe('offline routers', () => {
  it('a job created while the router is offline stays pending and runs when the router returns', async () => {
    w = await createWorld();
    const r = await addRouter(w);

    // Healthy first: last_seen_at gets set.
    await w.poller.tick();
    const seen = (await router(w, r.id))['last_seen_at'];
    expect(seen).not.toBeNull();

    // Power cut.
    w.behaviors.set(r.id, { connectFailure: MOCK_FAILURE_PRESETS.offline });
    for (let i = 0; i < 2; i++) {
      await w.db.query(`update public.routers set last_polled_at = now() - interval '1 hour' where id = $1`, [r.id]);
      await w.poller.tick();
    }
    const down = await router(w, r.id);
    expect(down['status']).toBe('offline');
    expect(down['last_seen_at']).toEqual(seen); // preserved, not overwritten

    // A sync requested now waits, without burning attempts.
    const id = await enqueue(w, r.id, 'router.sync');
    await runJobs(w);
    let j = await job(w, id);
    expect(j.status).toBe('pending');
    expect(j.attempts).toBe(0);
    expect(j.deferrals).toBeGreaterThanOrEqual(1);
    expect(new Date(j.run_after).getTime()).toBeGreaterThan(Date.now());

    // Power returns; the circuit breaker's short test cooldown elapses; the next poll sees the router.
    w.behaviors.delete(r.id);
    await sleep(60);
    await w.db.query(`update public.routers set last_polled_at = now() - interval '1 hour' where id = $1`, [r.id]);
    await w.poller.tick();
    expect((await router(w, r.id))['status']).toBe('online');

    // The poller released the deferred job; it runs now.
    j = await job(w, id);
    expect(new Date(j.run_after).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    await runJobs(w);
    j = await job(w, id);
    expect(j).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('the poller skips routers whose circuit breaker is open but still records the missed poll', async () => {
    w = await createWorld({ breakerCooldownMs: 60_000 });
    const r = await addRouter(w);
    w.behaviors.set(r.id, { connectFailure: MOCK_FAILURE_PRESETS.offline });
    for (let i = 0; i < 3; i++) {
      await w.db.query(`update public.routers set last_polled_at = null where id = $1`, [r.id]);
      await w.poller.tick();
    }
    expect(w.access.isCircuitOpen({ id: r.id, is_demo: false })).toBe(true);
    const created = w.providers.length;
    await w.db.query(`update public.routers set last_polled_at = null where id = $1`, [r.id]);
    await w.poller.tick();
    expect(w.providers.length).toBe(created); // not contacted
    const m = await w.db.query<{ reachable: boolean }>(`select reachable from public.router_metrics where router_id = $1`, [r.id]);
    expect(m.rows).toHaveLength(4);
    expect(m.rows.every((x) => !x.reachable)).toBe(true);
  });

  it('staggers a polling backlog across the interval', async () => {
    w = await createWorld();
    for (let i = 0; i < 30; i++) await addRouter(w);
    await w.db.query(`update public.routers set last_polled_at = now() - interval '1 hour'`);
    const polled = await w.poller.tick();
    // 30 due × 15 s tick / 300 s interval = 1.5 → 2, +1 = 3 per tick.
    expect(polled).toBe(3);
  });
});

describe('retry policy', () => {
  it('a retryable failure is retried with backoff, then goes dead after max attempts', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    w.behaviors.set(r.id, { methodFailures: { getInterfaces: { kind: 'error', code: 'UNKNOWN', detail: 'hiccup' } } });
    const id = await enqueue(w, r.id, 'router.sync');
    for (let attempt = 1; attempt <= 5; attempt++) {
      await runJobs(w, 1);
      const j = await job(w, id);
      expect(j.attempts).toBe(attempt);
      if (attempt < 5) {
        expect(j.status).toBe('pending');
        expect(new Date(j.run_after).getTime()).toBeGreaterThan(Date.now());
        await fastForward(w, id);
      } else {
        expect(j).toMatchObject({ status: 'dead', last_error_code: 'UNKNOWN' });
      }
    }
    expect(await auditActions(r.id)).toContain('router.sync.dead');
  });

  it('a destructive job is NOT retried automatically, even for a transient error', async () => {
    // Phase 1 ships no destructive job types; register one for this test only (Phase 2 will add
    // hotspot-user delete / session disconnect with exactly this policy).
    const destructive: RegisteredJob = {
      policy: { label: 'Test delete', destructive: true, deferWhenOffline: false, maxAttempts: 5, userEnqueueable: false },
      needsConnection: true,
      handler: async (ctx) => {
        await ctx.access.run(ctx.router as never, (p) => p.getIdentity());
        return {};
      },
    };
    w = await createWorld({ registry: { ...DEFAULT_REGISTRY, 'test.destructive': destructive } });
    await w.db.query(`insert into public.job_types values ('test.destructive', 'test only', true, false, 5, false)`);
    const r = await addRouter(w);
    w.behaviors.set(r.id, { connectFailure: MOCK_FAILURE_PRESETS.offline });
    const ins = await w.db.query<{ id: string }>(
      `insert into public.jobs (tenant_id, router_id, type, max_attempts, idempotency_key) values ($1, $2, 'test.destructive', 5, $3) returning id`,
      [w.tenantId, r.id, randomUUID()],
    );
    const id = ins.rows[0]!.id;
    await runJobs(w);
    const j = await job(w, id);
    expect(j).toMatchObject({ status: 'failed', attempts: 1, last_error_code: 'UNREACHABLE' });
    // Nothing requeued it.
    await runJobs(w);
    expect((await job(w, id)).attempts).toBe(1);
  });

  it('an unexpected handler error becomes INTERNAL without leaking details', async () => {
    const broken: RegisteredJob = {
      policy: { label: 'broken', destructive: false, deferWhenOffline: false, maxAttempts: 1, userEnqueueable: false },
      needsConnection: false,
      handler: async () => {
        throw new Error('stack trace with secrets /etc/shadow');
      },
    };
    w = await createWorld({ registry: { ...DEFAULT_REGISTRY, 'test.broken': broken } });
    await w.db.query(`insert into public.job_types values ('test.broken', 'test only', false, false, 1, false)`);
    const r = await addRouter(w);
    const ins = await w.db.query<{ id: string }>(
      `insert into public.jobs (tenant_id, router_id, type, max_attempts, idempotency_key) values ($1, $2, 'test.broken', 1, $3) returning id`,
      [w.tenantId, r.id, randomUUID()],
    );
    await runJobs(w);
    const j = await job(w, ins.rows[0]!.id);
    expect(j).toMatchObject({ status: 'failed', last_error_code: 'INTERNAL', last_error: 'internal connector error' });
    expect(JSON.stringify(j)).not.toContain('/etc/shadow');
    expect(JobFailure).toBeDefined();
  });
});

describe('logs', () => {
  it('fetches the most recent log lines on demand', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    const id = await enqueue(w, r.id, 'router.fetch_logs', { limit: 2 });
    await runJobs(w);
    const j = await job(w, id);
    expect(j.status).toBe('succeeded');
    expect((j.result as { entries: unknown[] }).entries).toHaveLength(2);
  });

  it('the database rejects bad payloads before they reach the connector', async () => {
    w = await createWorld();
    const r = await addRouter(w);
    await expect(enqueue(w, r.id, 'router.fetch_logs', { limit: 100000 })).rejects.toThrow(/between 1 and 500/);
    await expect(enqueue(w, r.id, 'router.sync', { rm: '-rf' })).rejects.toThrow(/no parameters/);
    await expect(
      as(w.db, { kind: 'user', id: w.admin.id }, (tx) =>
        rpc(tx, 'enqueue_router_job', { p_router_id: r.id, p_type: 'router.ingest_credentials', p_idempotency_key: randomUUID() }),
      ),
    ).rejects.toThrow(/cannot be requested directly/);
  });
});
