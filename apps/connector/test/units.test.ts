import { describe, expect, it } from 'vitest';
import type { JobTypePolicy } from '@hotzonex/shared/jobs';
import { ConfigError, loadConfig, parseRetiredKeys } from '../src/config.js';
import { decideOnFailure } from '../src/jobs/policy.js';
import { startHealthServer } from '../src/server.js';
import { parseWgDump, type WgManager, type WgPeer } from '../src/wireguard/manager.js';
import { WgReconciler, isPoolAddress } from '../src/wireguard/reconciler.js';
import { createLogger } from '../src/logger.js';
import { LogCapture } from './world.js';
import type { ConnectorStore } from '../src/store/store.js';

const read: JobTypePolicy = { label: 'sync', destructive: false, deferWhenOffline: true, maxAttempts: 5, userEnqueueable: true };
const once: JobTypePolicy = { label: 'test', destructive: false, deferWhenOffline: false, maxAttempts: 1, userEnqueueable: true };
const destructive: JobTypePolicy = { label: 'delete', destructive: true, deferWhenOffline: false, maxAttempts: 5, userEnqueueable: false };
const now = 1_000_000_000_000;

describe('job failure policy', () => {
  it('defers offline routers without consuming attempts', () => {
    const d = decideOnFailure({ policy: read, code: 'UNREACHABLE', attempts: 1, deferrals: 0, now, random: () => 0.5 });
    expect(d).toEqual({ outcome: 'defer', runAfter: new Date(now + 60_000), refundAttempt: true });
  });

  it('waits at least until an open circuit breaker allows a probe', () => {
    const d = decideOnFailure({ policy: read, code: 'UNREACHABLE', attempts: 1, deferrals: 0, circuitOpenUntil: now + 10 * 60_000, now, random: () => 0.5 });
    expect(d.runAfter?.getTime()).toBe(now + 10 * 60_000);
  });

  it('retries transient errors with exponential backoff, then goes dead', () => {
    const at = (attempts: number) => decideOnFailure({ policy: read, code: 'UNKNOWN', attempts, deferrals: 0, now, random: () => 0.5 });
    expect(at(1)).toMatchObject({ outcome: 'retry', runAfter: new Date(now + 30_000) });
    expect(at(2)).toMatchObject({ outcome: 'retry', runAfter: new Date(now + 60_000) });
    expect(at(4)).toMatchObject({ outcome: 'retry', runAfter: new Date(now + 240_000) });
    expect(at(5)).toMatchObject({ outcome: 'dead' });
  });

  it('fails immediately on errors a retry cannot fix', () => {
    for (const code of ['AUTH_FAILED', 'PERMISSION_DENIED', 'TLS_ERROR', 'INVALID_COMMAND', 'NO_CREDENTIALS'] as const) {
      expect(decideOnFailure({ policy: read, code, attempts: 1, deferrals: 0, now }).outcome, code).toBe('failed');
    }
  });

  it('single-shot jobs (connection tests) report failure rather than dying', () => {
    expect(decideOnFailure({ policy: once, code: 'TIMEOUT', attempts: 1, deferrals: 0, now }).outcome).toBe('failed');
  });

  it('never auto-retries destructive jobs', () => {
    for (const code of ['UNREACHABLE', 'TIMEOUT', 'UNKNOWN', 'INTERNAL'] as const) {
      expect(decideOnFailure({ policy: destructive, code, attempts: 1, deferrals: 0, now }).outcome, code).toBe('failed');
    }
  });
});

describe('config', () => {
  const good = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ENCRYPTION_KEY_VERSION: '1',
  };

  it('applies conservative defaults', () => {
    const c = loadConfig(good);
    expect(c).toMatchObject({ MIKROTIK_PROVIDER: 'mock', HEALTH_POLL_INTERVAL_SECONDS: 300, JOB_POLL_INTERVAL_SECONDS: 10, WG_INTERFACE: 'wg0' });
  });

  it('treats empty values copied from .env.example as unset', () => {
    const c = loadConfig({ ...good, CONNECTOR_ID: '', WG_SERVER_PUBLIC_KEY: '', WG_ENDPOINT: '  ', ENCRYPTION_KEYS_RETIRED: '' });
    expect(c.WG_SERVER_PUBLIC_KEY).toBeUndefined();
    expect(c.WG_ENDPOINT).toBeUndefined();
    expect(c.CONNECTOR_ID).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    expect(() => loadConfig({ ...good, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY: is required/);
  });

  it('lists problems by name without echoing secret values', () => {
    try {
      loadConfig({ ...good, ENCRYPTION_KEY: 'short-secret-value', MIKROTIK_PROVIDER: 'api' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const msg = (error as Error).message;
      expect(msg).toMatch(/ENCRYPTION_KEY/);
      expect(msg).toMatch(/WG_SERVER_PUBLIC_KEY: is required/);
      expect(msg).toMatch(/WG_ENDPOINT: is required/);
      expect(msg).not.toContain('short-secret-value');
      expect(msg).not.toContain('x'.repeat(40));
    }
  });

  it('parses retired keys', () => {
    const k = Buffer.alloc(32, 1).toString('base64');
    expect(parseRetiredKeys(`1:${k}`)).toEqual([{ version: 1, key: k }]);
    expect(() => parseRetiredKeys('1:tooshort')).toThrow(ConfigError);
  });
});

describe('WireGuard', () => {
  it('parses `wg show dump`', () => {
    const dump = [
      'PRIVATEKEY\tSERVERPUB\t51820\toff',
      'kA8y4gUcJ8Tf8p0y5e1F2wdmS3O0Jx1xq6y9E2y3Z0I=\t(none)\t102.1.2.3:13231\t10.77.0.5/32\t1757590000\t100\t200\t25',
      'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\t(none)\t(none)\t10.77.0.6/32\t0\t0\t0\toff',
    ].join('\n');
    expect(parseWgDump(dump)).toEqual([
      { publicKey: 'kA8y4gUcJ8Tf8p0y5e1F2wdmS3O0Jx1xq6y9E2y3Z0I=', allowedIps: ['10.77.0.5/32'], latestHandshake: new Date(1757590000 * 1000) },
      { publicKey: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', allowedIps: ['10.77.0.6/32'], latestHandshake: null },
    ]);
  });

  it('only treats router-pool addresses as Hotzonex-owned', () => {
    expect(isPoolAddress('10.77.3.4/32')).toBe(true);
    expect(isPoolAddress('10.77.0.1/32')).toBe(false);
    expect(isPoolAddress('10.78.0.2/32')).toBe(false);
    expect(isPoolAddress('10.77.0.0/16')).toBe(false);
  });

  it('reconciles peers declaratively and never removes non-Hotzonex peers', async () => {
    const K = (c: string) => `${c.repeat(42)}A=`;
    const peers = new Map<string, WgPeer>([
      [K('a'), { publicKey: K('a'), allowedIps: ['10.77.0.9/32'], latestHandshake: null }], // wrong address → update
      [K('b'), { publicKey: K('b'), allowedIps: ['10.77.0.7/32'], latestHandshake: null }], // deleted router → remove
      [K('c'), { publicKey: K('c'), allowedIps: ['192.168.50.2/32'], latestHandshake: null }], // admin laptop → keep
    ]);
    const calls: string[] = [];
    const wg: WgManager = {
      kind: 'simulated',
      listPeers: async () => [...peers.values()],
      setPeer: async (k, a) => {
        calls.push(`set ${k[0]} ${a}`);
        peers.set(k, { publicKey: k, allowedIps: [`${a}/32`], latestHandshake: new Date(0) });
      },
      removePeer: async (k) => {
        calls.push(`remove ${k[0]}`);
        peers.delete(k);
      },
    };
    let handshakes: unknown = null;
    const store = {
      wgPeers: async () => [
        { router_id: 'r1', wg_public_key: K('a'), wg_address: '10.77.0.5' },
        { router_id: 'r2', wg_public_key: K('d'), wg_address: '10.77.0.6' },
      ],
      recordHandshakes: async (h: unknown) => {
        handshakes = h;
        return 2;
      },
    } as unknown as ConnectorStore;
    const result = await new WgReconciler(store, wg, createLogger('silent' as never, new LogCapture())).reconcile();
    expect(result).toMatchObject({ added: 1, updated: 1, removed: 1 });
    expect(calls.sort()).toEqual(['remove b', 'set a 10.77.0.5', 'set d 10.77.0.6']);
    expect(peers.has(K('c'))).toBe(true);
    expect((handshakes as unknown[]).length).toBe(2);
  });
});

describe('/healthz', () => {
  it('serves health and nothing else', async () => {
    let ok = true;
    const server = await startHealthServer('127.0.0.1', 0, () => ({ ok, body: { status: ok ? 'ok' : 'degraded' } }));
    const port = (server.address() as { port: number }).port;
    try {
      const good = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(good.status).toBe(200);
      expect(await good.json()).toEqual({ status: 'ok' });
      ok = false;
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(503);
      expect((await fetch(`http://127.0.0.1:${port}/jobs`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/healthz`, { method: 'POST' })).status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('logger redaction', () => {
  it('redacts secret-bearing fields even if someone logs them by mistake', () => {
    const cap = new LogCapture();
    const log = createLogger('info', cap);
    log.info({ password: 'hunter2hunter2', params: { password: 'nested-secret-1' }, sealed: { ct: 'abc' }, authorization: 'Bearer x' }, 'oops');
    expect(cap.text).not.toContain('hunter2hunter2');
    expect(cap.text).not.toContain('nested-secret-1');
    expect(cap.text).not.toContain('Bearer x');
    expect(cap.text).toContain('[redacted]');
  });
});
