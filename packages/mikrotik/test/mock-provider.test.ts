import { describe, expect, it } from 'vitest';
import { MikrotikError } from '../src/errors.js';
import { MOCK_FAILURE_PRESETS, MockMikrotikProvider, type MockBehavior } from '../src/mock/provider.js';
import type { ConnectionParams } from '../src/types.js';

const params: ConnectionParams = { host: '10.77.0.5', port: 8728, protocol: 'api', useSsl: false, username: 'hotzonex-api', password: 'x'.repeat(24), timeoutMs: 30 };

describe('MockMikrotikProvider', () => {
  it('is deterministic per host and returns realistic data', async () => {
    const a = new MockMikrotikProvider(params);
    const b = new MockMikrotikProvider(params);
    expect(a.fixtures.identity).toBe(b.fixtures.identity);
    expect(new MockMikrotikProvider({ ...params, host: '10.77.0.6' }).fixtures.identity).not.toBe(a.fixtures.identity);
    const test = await a.testConnection();
    expect(test.routerOsVersion).toMatch(/^7\./);
    const res = await a.getSystemResource();
    expect(res.totalMemory).toBeGreaterThan(res.freeMemory);
    expect(res.cpuLoad).toBeGreaterThanOrEqual(0);
    expect(res.cpuLoad).toBeLessThanOrEqual(100);
    expect((await a.getHotspotServers()).length).toBeGreaterThan(0);
  });

  it.each([
    ['offline', MOCK_FAILURE_PRESETS.offline, 'UNREACHABLE'],
    ['authFailed', MOCK_FAILURE_PRESETS.authFailed, 'AUTH_FAILED'],
    ['apiDisabled', MOCK_FAILURE_PRESETS.apiDisabled, 'API_DISABLED'],
    ['timeout', MOCK_FAILURE_PRESETS.timeout, 'TIMEOUT'],
    ['malformed', MOCK_FAILURE_PRESETS.malformed, 'UNKNOWN'],
  ] as const)('injects %s at connect', async (_name, failure, code) => {
    const p = new MockMikrotikProvider(params, { behavior: { connectFailure: failure } });
    await expect(p.testConnection()).rejects.toMatchObject({ name: 'MikrotikError', code });
  });

  it('fails the next N calls on demand, then recovers', async () => {
    const p = new MockMikrotikProvider(params);
    p.failNext('getInterfaces', MOCK_FAILURE_PRESETS.permissionDenied, 2);
    await expect(p.getInterfaces()).rejects.toBeInstanceOf(MikrotikError);
    await expect(p.getInterfaces()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await p.getInterfaces()).not.toHaveLength(0);
  });

  it('reads behaviour live, so a router can "power off" mid-session', async () => {
    let behavior: MockBehavior = {};
    const p = new MockMikrotikProvider(params, { behavior: () => behavior });
    await p.getIdentity();
    behavior = { connectFailure: MOCK_FAILURE_PRESETS.offline };
    await expect(p.getIdentity()).rejects.toMatchObject({ code: 'UNREACHABLE' });
    behavior = {};
    expect(await p.getIdentity()).toEqual({ name: p.fixtures.identity });
  });

  it('checks credentials when told what to accept', async () => {
    const p = new MockMikrotikProvider(params, { acceptedCredentials: { username: 'hotzonex-api', password: 'other' } });
    await expect(p.connect()).rejects.toMatchObject({ code: 'AUTH_FAILED', stage: 'login' });
  });

  it('records every call so tests can prove sync is read-only', async () => {
    const p = new MockMikrotikProvider(params);
    await p.getHotspotProfiles();
    expect(p.calls).toEqual(['connect', 'getHotspotProfiles']);
  });
});
