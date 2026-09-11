import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RouterosApiProvider } from '../src/api/provider.js';
import { MikrotikError, type MikrotikErrorCode } from '../src/errors.js';
import type { ConnectionParams } from '../src/types.js';
import { STANDARD_DATA, closedPort, startFakeRouter, type FakeRouter, type FakeRouterOptions } from './fake-routeros-server.js';

const PASSWORD = 'CorrectHorseBatteryStaple42';
let router: FakeRouter | null = null;
const extraServers: net.Server[] = [];

afterEach(async () => {
  await router?.close();
  router = null;
  await Promise.all(extraServers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function provider(opts: FakeRouterOptions = {}, override: Partial<ConnectionParams> = {}): Promise<RouterosApiProvider> {
  router = await startFakeRouter({ data: STANDARD_DATA, ...opts });
  return new RouterosApiProvider({
    host: '127.0.0.1',
    port: router.port,
    protocol: 'api',
    useSsl: false,
    username: 'hotzonex-api',
    password: PASSWORD,
    timeoutMs: 400,
    ...override,
  });
}

async function expectCode(promise: Promise<unknown>, code: MikrotikErrorCode): Promise<MikrotikError> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ${code}, call succeeded`);
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MikrotikError);
  expect((error as MikrotikError).code).toBe(code);
  return error as MikrotikError;
}

describe('RouterosApiProvider against a fake RouterOS API server', () => {
  it('logs in and reports identity, version, board and architecture', async () => {
    const p = await provider();
    const result = await p.testConnection();
    expect(result).toMatchObject({ identity: 'Lologo-Gate', routerOsVersion: '7.19.4', boardName: 'hAP ax^3', architecture: 'arm64' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    await p.disconnect();
  });

  it('sends the password only inside the /login sentence', async () => {
    const p = await provider();
    await p.getInterfaces();
    await p.disconnect();
    const withPassword = router?.received.filter((s) => s.some((w) => w.includes(PASSWORD))) ?? [];
    expect(withPassword).toHaveLength(1);
    expect(withPassword[0]?.[0]).toBe('/login');
  });

  it('requests only the properties it needs (.proplist) to save metered bandwidth', async () => {
    const p = await provider();
    await p.getInterfaces();
    await p.disconnect();
    const sent = router?.received.find((s) => s[0] === '/interface/print');
    expect(sent?.some((w) => w.startsWith('=.proplist=.id,name,type'))).toBe(true);
  });

  it('maps every read method to typed data', async () => {
    const p = await provider({ emitEmpty: true });
    expect(await p.getIdentity()).toEqual({ name: 'Lologo-Gate' });
    expect(await p.getRouterOsVersion()).toEqual({ version: '7.19.4', channel: 'stable', buildTime: '2025-07-29 10:21:08' });
    expect((await p.getSystemResource()).uptimeSeconds).toBe(1307045);
    expect(await p.getInterfaces()).toHaveLength(2);
    expect((await p.getIpAddresses())[0]).toMatchObject({ address: '10.5.50.1/24', interface: 'bridge' });
    expect((await p.getHotspotServers())[0]).toMatchObject({ id: '*1', name: 'hotspot1', addressPool: 'hs-pool-1' });
    expect((await p.getHotspotProfiles()).map((x) => x.name)).toEqual(['default', '1hr-512k']);
    expect(await p.getHotspotUsers()).toEqual([]); // RouterOS 7.18 "!empty" reply
    expect(await p.getActiveHotspotUsers()).toEqual([]);
    expect((await p.getLogs({ limit: 2 })).map((l) => l.message)).toEqual(['line 3', 'line 4']);
    expect((await p.getSystemHealth()).sensors).toHaveLength(2);
    expect(await p.getCurrentUserPolicies()).toEqual({ username: 'hotzonex-api', group: 'hotzonex-api', policies: ['read', 'write', 'api', 'test'] });
    await p.disconnect();
  });

  it('matches untagged replies when only one request is in flight', async () => {
    const p = await provider({ untagged: true });
    expect(await p.getIdentity()).toEqual({ name: 'Lologo-Gate' });
    await p.disconnect();
  });

  describe('typed failures', () => {
    it('AUTH_FAILED on wrong password', async () => {
      const p = await provider({}, { password: 'WrongPasswordWrongPassword1' });
      const e = await expectCode(p.testConnection(), 'AUTH_FAILED');
      expect(e.stage).toBe('login');
      expect(e.message).not.toContain('WrongPassword');
    });

    it('API_DISABLED when the port refuses connections', async () => {
      const port = await closedPort();
      const p = new RouterosApiProvider({ host: '127.0.0.1', port, protocol: 'api', useSsl: false, username: 'u', password: PASSWORD, timeoutMs: 400 });
      const e = await expectCode(p.testConnection(), 'API_DISABLED');
      expect(e.stage).toBe('connect');
    });

    it('TIMEOUT when the router accepts TCP but never answers', async () => {
      const p = await provider({ silent: true });
      const e = await expectCode(p.testConnection(), 'TIMEOUT');
      expect(e.stage).toBe('login');
    });

    it('TLS_ERROR when api-ssl talks to a non-TLS service', async () => {
      const plain = net.createServer((s) => s.on('data', () => s.destroy()));
      extraServers.push(plain);
      await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
      const port = (plain.address() as net.AddressInfo).port;
      const p = new RouterosApiProvider({ host: '127.0.0.1', port, protocol: 'api_ssl', useSsl: true, username: 'u', password: PASSWORD, timeoutMs: 1000 });
      await expectCode(p.testConnection(), 'TLS_ERROR');
    });

    it('PERMISSION_DENIED when the group lacks a policy', async () => {
      const p = await provider({ traps: { '/ip/hotspot/print': 'not enough permissions (9)' } });
      await expectCode(p.getHotspotServers(), 'PERMISSION_DENIED');
      // The session stays usable after a command-level trap.
      expect(await p.getIdentity()).toEqual({ name: 'Lologo-Gate' });
      await p.disconnect();
    });

    it('NOT_FOUND for "no such item"', async () => {
      const p = await provider({ traps: { '/system/health/print': 'no such item' } });
      await expectCode(p.getSystemHealth(), 'NOT_FOUND');
      await p.disconnect();
    });

    it('ALREADY_EXISTS for "already have …"', async () => {
      const p = await provider({ traps: { '/log/print': 'failure: already have such name' } });
      await expectCode(p.getLogs(), 'ALREADY_EXISTS');
      await p.disconnect();
    });

    it('INVALID_COMMAND for an unknown menu (e.g. hotspot package missing)', async () => {
      const { ['/ip/hotspot/print']: _drop, ...data } = STANDARD_DATA;
      const p = await provider({ data });
      await expectCode(p.getHotspotServers(), 'INVALID_COMMAND');
      await p.disconnect();
    });

    it('UNKNOWN (malformed reply) for an unknown reply word', async () => {
      const p = await provider({ malformedFor: '/interface/print' });
      const e = await expectCode(p.getInterfaces(), 'UNKNOWN');
      expect(e.detail).toMatch(/malformed reply/);
    });

    it('UNREACHABLE when the router drops the session mid-command', async () => {
      const p = await provider({ dropFor: '/interface/print' });
      await expectCode(p.getInterfaces(), 'UNREACHABLE');
    });

    it('refuses pre-6.43 challenge login with a clear reason', async () => {
      const p = await provider({ legacyLogin: true });
      const e = await expectCode(p.testConnection(), 'INVALID_COMMAND');
      expect(e.detail).toMatch(/RouterOS v7 is required/);
    });

    it('reconnects after the session was lost', async () => {
      const p = await provider({ dropFor: '/interface/print' });
      await expectCode(p.getInterfaces(), 'UNREACHABLE');
      expect(await p.getIdentity()).toEqual({ name: 'Lologo-Gate' });
      await p.disconnect();
    });
  });
});
