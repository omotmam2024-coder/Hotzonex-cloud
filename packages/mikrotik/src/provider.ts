import type {
  ActiveHotspotUser,
  ConnectionTestResult,
  HotspotProfile,
  HotspotServer,
  HotspotUser,
  Interface,
  IpAddress,
  LogEntry,
  RouterOsVersion,
  SystemHealth,
  SystemResource,
  UserPolicies,
} from './types.js';

/**
 * Phase 1 surface: reads only. Hotspot user writes (create/update/delete/
 * enable/disconnect) arrive in Phase 2 as a separate `HotspotUserWriter`
 * interface so this one is extended, not rewritten (see docs/DECISIONS.md).
 *
 * Every method returns typed data or throws a MikrotikError.
 */
export interface MikrotikProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<ConnectionTestResult>;

  getSystemResource(): Promise<SystemResource>;
  getIdentity(): Promise<{ name: string }>;
  getRouterOsVersion(): Promise<RouterOsVersion>;
  getInterfaces(): Promise<Interface[]>;
  getIpAddresses(): Promise<IpAddress[]>;

  getHotspotServers(): Promise<HotspotServer[]>;
  getHotspotProfiles(): Promise<HotspotProfile[]>;
  getHotspotUsers(): Promise<HotspotUser[]>;
  getActiveHotspotUsers(): Promise<ActiveHotspotUser[]>;

  getLogs(opts?: { limit?: number }): Promise<LogEntry[]>;
  getSystemHealth(): Promise<SystemHealth>;

  /** Group and policies of the user we are logged in as — powers "test permissions". */
  getCurrentUserPolicies(): Promise<UserPolicies>;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_LOG_LIMIT = 100;
export const MAX_LOG_LIMIT = 1000;

export function clampLogLimit(limit: number | undefined): number {
  const n = Math.trunc(limit ?? DEFAULT_LOG_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LOG_LIMIT;
  return Math.min(n, MAX_LOG_LIMIT);
}
