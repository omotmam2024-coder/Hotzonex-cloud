import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorStore, StoreError } from '../src/store/store.js';
import { SupabaseTransport } from '../src/store/supabase-transport.js';
import { startFakePostgrest } from './fake-postgrest.js';
import { addRouter, createWorld, enqueue, job, type World } from './world.js';

const KEY = `service-${randomUUID()}`;
let w: World;
let api: Awaited<ReturnType<typeof startFakePostgrest>>;

afterEach(async () => {
  await api?.close();
  await w?.close();
});

describe('SupabaseTransport (real supabase-js client over HTTP)', () => {
  it('drives the job lifecycle and sync through RPC exactly like the in-process transport', async () => {
    w = await createWorld();
    api = await startFakePostgrest(w.db, KEY);
    const store = new ConnectorStore(new SupabaseTransport(api.url, KEY, 'http-connector'));
    const r = await addRouter(w);
    const id = await enqueue(w, r.id, 'router.sync');

    const claimed = await store.claimJobs('http-connector', 5, 60);
    expect(claimed.map((j) => j.id)).toEqual([id]);
    const started = await store.startJob(id, 'http-connector');
    expect(started?.attempts).toBe(1);
    expect(await store.startJob(id, 'someone-else')).toBeNull();

    const summary = await store.applySync(r.id, {
      identity: 'Gate', routeros_version: '7.19.4', board_name: 'hAP ax^3', architecture: 'arm64',
      interfaces: [{ mikrotik_id: '*1', name: 'ether1', type: 'ether' }], hotspot_servers: [], hotspot_profiles: [],
    });
    expect(summary.interfaces.added).toBe(1);
    await store.finishJob({ jobId: id, connectorId: 'http-connector', outcome: 'succeeded', result: JSON.parse(JSON.stringify(summary)) });
    expect((await job(w, id)).status).toBe('succeeded');

    const router = await store.getRouter(r.id);
    expect(router).toMatchObject({ id: r.id, credentials_status: 'set', api_protocol: 'api' });
    expect(router?.password_ciphertext).toMatch(/^v1\./);
    expect(await store.releaseRouterJobs(r.id)).toBe(0);
    await store.heartbeat('http-connector', {
      version: '0.1.0', provider_mode: 'mock', sealing_key_id: w.sealing.current.kid,
      sealing_public_key: w.sealing.current.publicKey.jwk, wg_server_public_key: null, wg_endpoint: null,
      wg_server_address: '10.77.0.1', started_at: new Date().toISOString(),
    });
    const hb = await w.db.query(`select connector_id, provider_mode from public.connector_status`);
    expect(hb.rows).toEqual([{ connector_id: 'http-connector', provider_mode: 'mock' }]);
    expect(api.requests).toEqual(expect.arrayContaining(['connector_claim_jobs', 'connector_apply_sync', 'connector_heartbeat']));
  });

  it('surfaces data-plane errors as StoreError without leaking the key', async () => {
    w = await createWorld();
    api = await startFakePostgrest(w.db, KEY);
    const wrongKey = new ConnectorStore(new SupabaseTransport(api.url, 'not-the-key-000000000000', 'x'));
    const err = await wrongKey.claimJobs('x', 1, 60).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect((err as Error).message).not.toContain(KEY);

    const unreachable = new ConnectorStore(new SupabaseTransport('http://127.0.0.1:9', KEY, 'x'));
    const down = await unreachable.claimJobs('x', 1, 60).catch((e: unknown) => e);
    expect(down).toBeInstanceOf(StoreError);
    expect((down as Error).message).toMatch(/data plane unreachable/);
  });
});
