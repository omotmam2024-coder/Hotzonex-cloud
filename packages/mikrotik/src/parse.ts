import { MikrotikError } from './errors.js';
import type {
  ActiveHotspotUser,
  HealthSensor,
  HotspotProfile,
  HotspotServer,
  HotspotUser,
  Interface,
  IpAddress,
  LogEntry,
  RouterOsVersion,
  SystemResource,
} from './types.js';

/**
 * RouterOS returns every value as a string (API words and REST JSON alike).
 * These helpers turn a raw record into typed data, and throw
 * MikrotikError(UNKNOWN, 'malformed reply') when a required field is missing.
 */
export type RawRecord = Record<string, string | undefined>;

export function malformed(what: string): MikrotikError {
  return new MikrotikError('UNKNOWN', 'command', `malformed reply: ${what}`);
}

export function requireString(r: RawRecord, key: string): string {
  const v = r[key];
  if (v === undefined) throw malformed(`missing "${key}"`);
  return v;
}

export function optString(r: RawRecord, key: string): string | null {
  const v = r[key];
  return v === undefined || v === '' ? null : v;
}

export function parseBool(value: string | undefined): boolean {
  return value === 'true' || value === 'yes';
}

export function optInt(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function intOrZero(value: string | undefined): number {
  return optInt(value) ?? 0;
}

export function optNumber(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const UNIT_SECONDS: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };

/**
 * Parse RouterOS durations: "1w2d3h4m5s", "4m30s", "250ms", "00:05:00",
 * "1d00:05:00", "2w3d04:05:06". Returns whole seconds, or null for
 * "none"/empty/unparseable values.
 */
export function parseDuration(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (v === '' || v === 'none') return null;

  let total = 0;
  let rest = v;

  // Trailing clock part "hh:mm:ss" (older format, optionally prefixed by "1w2d").
  const clock = /(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(rest);
  if (clock) {
    total += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    rest = rest.slice(0, clock.index);
  }

  if (rest !== '') {
    const re = /(\d+)(ms|w|d|h|m|s)/g;
    let consumed = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(rest)) !== null) {
      consumed += match[0].length;
      const unit = match[2] as string;
      if (unit !== 'ms') total += Number(match[1]) * (UNIT_SECONDS[unit] ?? 0);
    }
    if (consumed !== rest.length) return null;
  }
  return total;
}

export function parseVersion(raw: string): RouterOsVersion {
  // "7.19.4 (stable)" | "7.20beta2 (testing)" | "6.49.10 (long-term)"
  const match = /^\s*([0-9][^\s(]*)\s*(?:\(([^)]+)\))?/.exec(raw);
  if (!match) throw malformed(`unrecognised version "${raw}"`);
  return { version: match[1] as string, channel: match[2] ?? null };
}

export function toSystemResource(r: RawRecord): SystemResource {
  const uptime = parseDuration(requireString(r, 'uptime'));
  if (uptime === null) throw malformed('uptime');
  const totalMemory = optInt(r['total-memory']);
  const freeMemory = optInt(r['free-memory']);
  if (totalMemory === null || freeMemory === null) throw malformed('memory');
  const cpuLoad = optInt(r['cpu-load']);
  if (cpuLoad === null) throw malformed('cpu-load');
  return {
    uptimeSeconds: uptime,
    version: requireString(r, 'version'),
    buildTime: optString(r, 'build-time'),
    freeMemory,
    totalMemory,
    cpu: optString(r, 'cpu'),
    cpuCount: optInt(r['cpu-count']),
    cpuFrequencyMhz: optInt(r['cpu-frequency']),
    cpuLoad: Math.min(100, Math.max(0, cpuLoad)),
    freeHddSpace: optInt(r['free-hdd-space']),
    totalHddSpace: optInt(r['total-hdd-space']),
    architecture: optString(r, 'architecture-name'),
    boardName: optString(r, 'board-name'),
    platform: optString(r, 'platform'),
  };
}

export function toInterface(r: RawRecord): Interface {
  return {
    id: requireString(r, '.id'),
    name: requireString(r, 'name'),
    type: optString(r, 'type') ?? 'unknown',
    macAddress: optString(r, 'mac-address'),
    running: parseBool(r['running']),
    disabled: parseBool(r['disabled']),
    rxBytes: intOrZero(r['rx-byte']),
    txBytes: intOrZero(r['tx-byte']),
    mtu: optInt(r['mtu']),
    comment: optString(r, 'comment'),
  };
}

export function toIpAddress(r: RawRecord): IpAddress {
  return {
    id: requireString(r, '.id'),
    address: requireString(r, 'address'),
    network: optString(r, 'network'),
    interface: requireString(r, 'interface'),
    disabled: parseBool(r['disabled']),
    dynamic: parseBool(r['dynamic']),
  };
}

export function toHotspotServer(r: RawRecord): HotspotServer {
  return {
    id: requireString(r, '.id'),
    name: requireString(r, 'name'),
    interface: optString(r, 'interface'),
    addressPool: optString(r, 'address-pool'),
    profile: optString(r, 'profile'),
    disabled: parseBool(r['disabled']),
    invalid: parseBool(r['invalid']),
  };
}

export function toHotspotProfile(r: RawRecord): HotspotProfile {
  const shared = r['shared-users'];
  return {
    id: requireString(r, '.id'),
    name: requireString(r, 'name'),
    rateLimit: optString(r, 'rate-limit'),
    sharedUsers: shared === 'unlimited' ? null : optInt(shared),
    sessionTimeoutSeconds: parseDuration(r['session-timeout']),
    idleTimeoutSeconds: parseDuration(r['idle-timeout']),
    keepaliveTimeoutSeconds: parseDuration(r['keepalive-timeout']),
    addressPool: optString(r, 'address-pool') === 'none' ? null : optString(r, 'address-pool'),
    isDefault: parseBool(r['default']) || r['name'] === 'default',
  };
}

export function toHotspotUser(r: RawRecord): HotspotUser {
  return {
    id: requireString(r, '.id'),
    name: requireString(r, 'name'),
    profile: optString(r, 'profile'),
    server: optString(r, 'server'),
    disabled: parseBool(r['disabled']),
    comment: optString(r, 'comment'),
    limitUptimeSeconds: parseDuration(r['limit-uptime']),
    limitBytesTotal: optInt(r['limit-bytes-total']),
    uptimeSeconds: parseDuration(r['uptime']) ?? 0,
    bytesIn: intOrZero(r['bytes-in']),
    bytesOut: intOrZero(r['bytes-out']),
  };
}

export function toActiveHotspotUser(r: RawRecord): ActiveHotspotUser {
  return {
    id: requireString(r, '.id'),
    server: optString(r, 'server'),
    user: requireString(r, 'user'),
    address: optString(r, 'address'),
    macAddress: optString(r, 'mac-address'),
    loginBy: optString(r, 'login-by'),
    uptimeSeconds: parseDuration(r['uptime']) ?? 0,
    idleTimeSeconds: parseDuration(r['idle-time']),
    sessionTimeLeftSeconds: parseDuration(r['session-time-left']),
    bytesIn: intOrZero(r['bytes-in']),
    bytesOut: intOrZero(r['bytes-out']),
  };
}

export function toLogEntry(r: RawRecord): LogEntry {
  return {
    id: requireString(r, '.id'),
    time: optString(r, 'time') ?? '',
    topics: (optString(r, 'topics') ?? '').split(',').filter(Boolean),
    message: optString(r, 'message') ?? '',
  };
}

/**
 * RouterOS v7 returns one row per sensor ({name, value, type}); v6 returns a
 * single row with one property per sensor. Accept both.
 */
export function toHealthSensors(rows: RawRecord[]): HealthSensor[] {
  if (rows.length === 0) return [];
  const first = rows[0] as RawRecord;
  if ('name' in first && 'value' in first) {
    return rows.map((r) => {
      const value = r['value'];
      const numeric = optNumber(value);
      return {
        name: requireString(r, 'name'),
        value: numeric,
        unit: optString(r, 'type'),
        state: numeric === null ? (value ?? null) : null,
      };
    });
  }
  return Object.entries(first)
    .filter(([key]) => !key.startsWith('.'))
    .map(([name, value]) => {
      const numeric = optNumber(value);
      return { name, value: numeric, unit: null, state: numeric === null ? (value ?? null) : null };
    });
}

/** "read,write,api,!ftp,!policy" → ["read","write","api"] */
export function parsePolicyList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '' && !p.startsWith('!'));
}
