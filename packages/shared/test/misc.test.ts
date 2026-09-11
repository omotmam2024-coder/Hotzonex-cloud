import { describe, expect, it } from 'vitest';
import { MIKROTIK_ERROR_CODES } from '@hotzonex/mikrotik/errors';
import { DB_HINT_MESSAGES, JOB_ERROR_MESSAGES, MIKROTIK_ERROR_MESSAGES, describeJobError } from '../src/errors.js';
import { JOB_ERROR_CODES } from '../src/jobs.js';
import { capabilitiesFor } from '../src/roles.js';
import { locationSchema, routerSchema } from '../src/schemas.js';
import { assessHealth, statusAfterFailure } from '../src/status.js';
import { formatBytes, formatDuration, formatRelative, freshness } from '../src/time.js';

describe('human error messages', () => {
  it('has a specific title, explanation and next action for every MikroTik code', () => {
    expect(Object.keys(MIKROTIK_ERROR_MESSAGES).sort()).toEqual([...MIKROTIK_ERROR_CODES].sort());
    for (const m of Object.values(MIKROTIK_ERROR_MESSAGES)) {
      expect(m.title.length).toBeGreaterThan(5);
      expect(m.explanation.length).toBeGreaterThan(20);
      expect(m.nextAction.length).toBeGreaterThan(10);
    }
  });

  it('covers every job error code and falls back safely', () => {
    for (const code of JOB_ERROR_CODES) expect(describeJobError(code).title).toBeTruthy();
    expect(describeJobError('SOMETHING_NEW')).toEqual(JOB_ERROR_MESSAGES.INTERNAL);
    expect(describeJobError(null)).toEqual(JOB_ERROR_MESSAGES.INTERNAL);
  });

  it('maps every hint raised by the database migrations', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '..', '..', '..', 'supabase', 'migrations');
    const hints = new Set<string>();
    for (const f of readdirSync(dir)) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/hint = '([a-z_]+)'/g)) hints.add(m[1] as string);
    }
    expect(hints.size).toBeGreaterThan(5);
    for (const h of hints) expect(DB_HINT_MESSAGES[h], h).toBeTruthy();
  });
});

describe('status rules', () => {
  it('assesses reachable routers by CPU, memory and sensors', () => {
    expect(assessHealth({ cpuLoad: 10, freeMemory: 600, totalMemory: 1000, sensors: [] })).toEqual({ status: 'online', reason: null });
    expect(assessHealth({ cpuLoad: 90, freeMemory: 600, totalMemory: 1000, sensors: [] }).status).toBe('warning');
    expect(assessHealth({ cpuLoad: 10, freeMemory: 20, totalMemory: 1000, sensors: [] }).status).toBe('critical');
    expect(assessHealth({ cpuLoad: 10, freeMemory: 600, totalMemory: 1000, sensors: [{ name: 'psu1-state', value: null, state: 'fail' }] }).status).toBe('critical');
    expect(assessHealth({ cpuLoad: 10, freeMemory: 600, totalMemory: 1000, sensors: [{ name: 'cpu-temperature', value: 80, state: null }] }).status).toBe('warning');
  });

  it('goes OFFLINE only after N consecutive failures', () => {
    expect(statusAfterFailure('online', 0, 2)).toBe('warning');
    expect(statusAfterFailure('warning', 1, 2)).toBe('offline');
    expect(statusAfterFailure('unknown', 0, 2)).toBe('unknown');
    expect(statusAfterFailure('offline', 7, 2)).toBe('offline');
    expect(statusAfterFailure('online', 0, 1)).toBe('offline');
  });
});

describe('time helpers', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(86400 * 3 + 3600 * 4)).toBe('3d 4h');
    expect(formatDuration(null)).toBe('—');
  });

  it('computes freshness against the poll interval', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(freshness('2026-09-11T11:56:00Z', 300, now)).toBe('fresh');
    expect(freshness('2026-09-11T11:48:00Z', 300, now)).toBe('stale');
    expect(freshness('2026-09-11T10:00:00Z', 300, now)).toBe('lost');
    expect(freshness(null, 300, now)).toBe('never');
    expect(formatRelative('2026-09-11T11:55:00Z', now)).toBe('5 min ago');
    expect(formatBytes(1536)).toBe('1.5 KiB');
  });
});

describe('capabilities mirror the RLS policies', () => {
  it('technicians operate routers but cannot delete them or manage locations/settings', () => {
    expect(capabilitiesFor('TECHNICIAN')).toMatchObject({ editRouters: true, deleteRouters: false, manageLocations: false, manageSettings: false });
    expect(capabilitiesFor('ADMIN')).toMatchObject({ deleteRouters: true, manageLocations: true, manageTeam: true });
    expect(capabilitiesFor('CUSTOMER').viewNetwork).toBe(false);
  });
});

describe('boundary schemas', () => {
  it('validates GPS coordinates in pairs', () => {
    const base = { name: 'Gorom', address: '', contact: '', opening_hours: '', status: 'active' as const };
    expect(locationSchema.parse({ ...base, lat: '4.8594', lng: '31.5713' })).toMatchObject({ lat: 4.8594, lng: 31.5713, address: null });
    expect(locationSchema.safeParse({ ...base, lat: '95', lng: '31' }).success).toBe(false);
    expect(locationSchema.safeParse({ ...base, lat: '4.8', lng: '' }).success).toBe(false);
    expect(locationSchema.parse({ ...base, lat: '', lng: '' })).toMatchObject({ lat: null, lng: null });
  });

  it('forces TLS off for api and on for api_ssl', () => {
    expect(routerSchema.parse({ name: 'r', location_id: null, api_protocol: 'api', api_port: 8728, use_ssl: true, notes: '' }).use_ssl).toBe(false);
    expect(routerSchema.parse({ name: 'r', location_id: null, api_protocol: 'api_ssl', api_port: 8729, use_ssl: false, notes: '' }).use_ssl).toBe(true);
    expect(routerSchema.safeParse({ name: 'r', location_id: null, api_protocol: 'telnet', api_port: 23, use_ssl: false, notes: '' }).success).toBe(false);
  });
});
