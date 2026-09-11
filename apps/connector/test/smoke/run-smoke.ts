/**
 * `pnpm --filter @hotzonex/connector smoke` — boots the BUILT connector
 * (dist/main.js, exactly what ships in Docker) against an in-memory data plane
 * (PGlite + a PostgREST stand-in), with MIKROTIK_PROVIDER=mock, and checks that
 * it heartbeats, serves /healthz, polls a DEMO router, and processes a job.
 * Requires `pnpm --filter @hotzonex/connector build` first.
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '@hotzonex/db/testing';
import { startFakePostgrest } from '../fake-postgrest.js';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, '..', '..', 'dist', 'main.js');
if (!existsSync(bundle)) {
  console.error('dist/main.js not found — run `pnpm --filter @hotzonex/connector build` first.');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const db = await createTestDb({ seed: true, fresh: true });
const key = `smoke-${randomUUID()}`;
const api = await startFakePostgrest(db, key);
const port = 18_000 + Math.floor(Math.random() * 1000);
const secret = 'Smoke-Test-Password-42';

const child = spawn(process.execPath, [bundle], {
  env: {
    PATH: process.env['PATH'] ?? '',
    SUPABASE_URL: api.url,
    SUPABASE_SERVICE_ROLE_KEY: key,
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: '1',
    MIKROTIK_PROVIDER: 'mock',
    HEALTHZ_HOST: '127.0.0.1',
    HEALTHZ_PORT: String(port),
    JOB_POLL_INTERVAL_SECONDS: '2',
    HEALTH_POLL_INTERVAL_SECONDS: '60',
    CONNECTOR_ID: 'smoke',
    LOG_LEVEL: 'info',
    MOCK_STATE_FILE: join(mkdtempSync(join(tmpdir(), 'hzx-')), 'mock.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d: Buffer) => (output += d.toString()));
child.stderr.on('data', (d: Buffer) => (output += d.toString()));

let ok = false;
try {
  const health = await waitFor('/healthz 200', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  });
  console.log('✔ /healthz:', JSON.stringify({ status: health['status'], provider: health['provider'], wireguard: health['wireguard'] }));

  const hb = await waitFor('heartbeat', async () => (await db.query(`select * from public.connector_status`)).rows[0]);
  console.log('✔ heartbeat recorded; sealing key published:', (hb as { sealing_key_id: string }).sealing_key_id);

  const polled = await waitFor('demo routers polled', async () => {
    const r = await db.query<{ name: string; status: string }>(`select name, status from public.routers where is_demo and last_polled_at is not null`);
    return r.rows.length === 3 ? r.rows : null;
  });
  console.log('✔ demo routers polled by the mock provider:', polled.map((r) => `${r.name}=${r.status}`).join(', '));

  const routerId = '00000000-0000-4000-8000-000000000201';
  await db.query(
    `insert into public.jobs (tenant_id, router_id, type, idempotency_key) values ('00000000-0000-4000-8000-000000000001', $1, 'router.sync', $2)`,
    [routerId, randomUUID()],
  );
  const synced = await waitFor('sync job', async () => {
    const r = await db.query<{ status: string }>(`select status from public.jobs where router_id = $1 and type = 'router.sync'`, [routerId]);
    return r.rows[0]?.status === 'succeeded' ? r.rows[0] : null;
  });
  const servers = await db.query(`select name from public.hotspot_servers where router_id = $1`, [routerId]);
  console.log(`✔ sync job ${synced.status}; ${servers.rows.length} hotspot server(s) discovered`);

  if (output.includes(secret) || output.includes(key)) throw new Error('a secret appeared in the connector output');
  console.log('✔ no secrets in connector output');
  ok = true;
} catch (error) {
  console.error(`✖ ${(error as Error).message}\n--- connector output ---\n${output.slice(-4000)}`);
} finally {
  child.kill('SIGTERM');
  await sleep(500);
  await api.close();
  await db.close();
}
process.exit(ok ? 0 : 1);
