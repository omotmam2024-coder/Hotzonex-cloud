import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MikrotikError, type MikrotikErrorCode } from '../src/errors.js';
import { RouterosRestProvider } from '../src/rest/provider.js';
import { closedPort } from './fake-routeros-server.js';

const USER = 'hotzonex-api';
const PASSWORD = 'CorrectHorseBatteryStaple42';

type Handler = (path: string, query: URLSearchParams, res: http.ServerResponse) => void;
let server: http.Server | null = null;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const defaultHandler: Handler = (path, query, res) => {
  switch (path) {
    case '/rest/system/identity':
      return json(res, 200, { name: 'Gorom-Core' });
    case '/rest/system/resource':
      return json(res, 200, {
        uptime: '3d4h', version: '7.19.4 (stable)', 'free-memory': '500000000', 'total-memory': '1073741824',
        'cpu-load': '12', 'board-name': 'RB5009UG+S+', 'architecture-name': 'arm64',
      });
    case '/rest/interface':
      return json(res, 200, [{ '.id': '*1', name: 'ether1', type: 'ether', running: 'true', disabled: 'false', 'rx-byte': '10', 'tx-byte': '20' }]);
    case '/rest/ip/hotspot':
      return json(res, 200, [{ '.id': '*1', name: 'hotspot1', interface: 'bridge', disabled: 'false' }]);
    case '/rest/ip/hotspot/user/profile':
      return json(res, 200, [{ '.id': '*0', name: 'default', 'shared-users': '1', default: 'true' }]);
    case '/rest/system/health':
      return json(res, 200, [{ '.id': '*1', name: 'voltage', value: '24.0', type: 'V' }]);
    case '/rest/user':
      return json(res, 200, query.get('name') === USER ? [{ '.id': '*2', name: USER, group: 'hotzonex-api' }] : []);
    case '/rest/user/group':
      return json(res, 200, [{ '.id': '*5', name: 'hotzonex-api', policy: 'read,write,rest-api,test,!ftp' }]);
    default:
      return json(res, 400, { error: 400, message: 'Bad Request', detail: 'no such command' });
  }
};

async function start(handler: Handler = defaultHandler, requireAuth = true): Promise<RouterosRestProvider> {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const expected = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
    if (requireAuth && req.headers.authorization !== expected) {
      return json(res, 401, { error: 401, message: 'Unauthorized' });
    }
    handler(url.pathname, url.searchParams, res);
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return new RouterosRestProvider({ host: '127.0.0.1', port, protocol: 'rest', useSsl: false, username: USER, password: PASSWORD, timeoutMs: 400 });
}

async function expectCode(promise: Promise<unknown>, code: MikrotikErrorCode): Promise<void> {
  const error = await promise.then(
    () => new Error('call succeeded'),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MikrotikError);
  expect((error as MikrotikError).code).toBe(code);
}

describe('RouterosRestProvider against a fake REST endpoint', () => {
  it('connects, tests and maps data', async () => {
    const p = await start();
    expect(await p.testConnection()).toMatchObject({ identity: 'Gorom-Core', routerOsVersion: '7.19.4', boardName: 'RB5009UG+S+' });
    expect((await p.getInterfaces())[0]).toMatchObject({ name: 'ether1', rxBytes: 10, running: true });
    expect((await p.getHotspotServers())[0]?.name).toBe('hotspot1');
    expect((await p.getHotspotProfiles())[0]?.isDefault).toBe(true);
    expect((await p.getSystemHealth()).sensors[0]).toMatchObject({ name: 'voltage', value: 24 });
    expect(await p.getCurrentUserPolicies()).toEqual({ username: USER, group: 'hotzonex-api', policies: ['read', 'write', 'rest-api', 'test'] });
    await p.disconnect();
  });

  it('AUTH_FAILED on 401', async () => {
    await start();
    const port = (server?.address() as AddressInfo).port;
    const bad = new RouterosRestProvider({ host: '127.0.0.1', port, protocol: 'rest', useSsl: false, username: USER, password: 'nope-nope-nope-nope-nope', timeoutMs: 400 });
    await expectCode(bad.testConnection(), 'AUTH_FAILED');
  });

  it('PERMISSION_DENIED on 403', async () => {
    const p = await start((path, q, res) =>
      path === '/rest/ip/hotspot' ? json(res, 403, { error: 403, message: 'Forbidden' }) : defaultHandler(path, q, res),
    );
    await expectCode(p.getHotspotServers(), 'PERMISSION_DENIED');
    await p.disconnect();
  });

  it('INVALID_COMMAND on "no such command"', async () => {
    const p = await start();
    await expectCode(p.getActiveHotspotUsers(), 'INVALID_COMMAND');
    await p.disconnect();
  });

  it('UNKNOWN (malformed reply) when the body is not JSON', async () => {
    const p = await start((path, q, res) => {
      if (path === '/rest/interface') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>WebFig</html>');
        return;
      }
      defaultHandler(path, q, res);
    });
    await expectCode(p.getInterfaces(), 'UNKNOWN');
    await p.disconnect();
  });

  it('TIMEOUT when the router never answers', async () => {
    const p = await start((path, q, res) => {
      if (path === '/rest/interface') return; // hang
      defaultHandler(path, q, res);
    });
    await expectCode(p.getInterfaces(), 'TIMEOUT');
    await p.disconnect();
  });

  it('API_DISABLED when www/www-ssl is off (connection refused)', async () => {
    const port = await closedPort();
    const p = new RouterosRestProvider({ host: '127.0.0.1', port, protocol: 'rest', useSsl: false, username: USER, password: PASSWORD, timeoutMs: 400 });
    await expectCode(p.testConnection(), 'API_DISABLED');
  });
});
