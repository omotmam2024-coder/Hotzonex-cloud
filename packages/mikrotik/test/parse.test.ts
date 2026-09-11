import { describe, expect, it } from 'vitest';
import { MikrotikError } from '../src/errors.js';
import { parseDuration, parsePolicyList, parseVersion, toHealthSensors, toHotspotProfile, toSystemResource } from '../src/parse.js';
import { RESOURCE_ROW } from './fake-routeros-server.js';

describe('parseDuration', () => {
  it.each([
    ['5s', 5],
    ['4m30s', 270],
    ['1w2d3h4m5s', 788645],
    ['250ms', 0],
    ['1s500ms', 1],
    ['00:05:00', 300],
    ['1d00:05:00', 86700],
    ['2w3d04:05:06', 1483506],
  ])('%s → %i seconds', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'none', 'forever', '5 minutes'])('%j → null', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('parseVersion', () => {
  it('splits version and channel', () => {
    expect(parseVersion('7.19.4 (stable)')).toEqual({ version: '7.19.4', channel: 'stable' });
    expect(parseVersion('7.20beta2 (testing)')).toEqual({ version: '7.20beta2', channel: 'testing' });
    expect(parseVersion('7.16')).toEqual({ version: '7.16', channel: null });
  });

  it('throws a typed malformed-reply error on garbage', () => {
    expect(() => parseVersion('banana')).toThrow(MikrotikError);
  });
});

describe('record mapping', () => {
  it('maps /system/resource', () => {
    const r = toSystemResource(RESOURCE_ROW);
    expect(r).toMatchObject({ uptimeSeconds: 1307045, cpuLoad: 7, totalMemory: 1073741824, boardName: 'hAP ax^3', architecture: 'arm64' });
  });

  it('rejects a resource reply without memory figures', () => {
    const { ['total-memory']: _drop, ...rest } = RESOURCE_ROW;
    expect(() => toSystemResource(rest)).toThrow(/malformed reply/);
  });

  it('maps hotspot profiles including "unlimited" and "none"', () => {
    expect(
      toHotspotProfile({ '.id': '*1', name: 'x', 'shared-users': 'unlimited', 'idle-timeout': 'none', 'session-timeout': '1h', 'address-pool': 'none' }),
    ).toMatchObject({ sharedUsers: null, idleTimeoutSeconds: null, sessionTimeoutSeconds: 3600, addressPool: null });
  });

  it('accepts v7 per-sensor health rows and v6 single-row health', () => {
    expect(toHealthSensors([{ name: 'voltage', value: '24.1', type: 'V' }, { name: 'fan1-state', value: 'ok', type: '' }])).toEqual([
      { name: 'voltage', value: 24.1, unit: 'V', state: null },
      { name: 'fan1-state', value: null, unit: null, state: 'ok' },
    ]);
    expect(toHealthSensors([{ voltage: '24.1', temperature: '40' }])).toEqual([
      { name: 'voltage', value: 24.1, unit: null, state: null },
      { name: 'temperature', value: 40, unit: null, state: null },
    ]);
  });

  it('parses policy lists, dropping negated policies', () => {
    expect(parsePolicyList('read,write,api,!ftp,!policy,test')).toEqual(['read', 'write', 'api', 'test']);
  });
});
