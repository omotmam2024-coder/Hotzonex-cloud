/**
 * Typed RouterOS data returned by every MikrotikProvider implementation.
 * Browser-safe: no Node imports.
 */

export type ApiProtocol = 'api' | 'api_ssl' | 'rest';

export const API_PROTOCOLS: readonly ApiProtocol[] = ['api', 'api_ssl', 'rest'];

export const DEFAULT_PORTS: Record<ApiProtocol, { plain: number; tls: number }> = {
  api: { plain: 8728, tls: 8729 },
  api_ssl: { plain: 8729, tls: 8729 },
  rest: { plain: 80, tls: 443 },
};

export interface ConnectionParams {
  /** Tunnel address of the router, e.g. 10.77.0.5. Never the ISP address. */
  host: string;
  port: number;
  protocol: ApiProtocol;
  /** TLS for REST (https) — api_ssl always uses TLS, api never does. */
  useSsl: boolean;
  username: string;
  password: string;
  /** Hard timeout for connect and for each command. Default 10 000 ms. */
  timeoutMs?: number;
  tls?: {
    /** Verify the router certificate. RouterOS ships self-signed certificates, so verification needs a CA. */
    rejectUnauthorized?: boolean;
    ca?: string;
  };
}

export interface ConnectionTestResult {
  latencyMs: number;
  identity: string;
  routerOsVersion: string;
  boardName: string | null;
  architecture: string | null;
}

export interface SystemResource {
  uptimeSeconds: number;
  version: string;
  buildTime: string | null;
  freeMemory: number;
  totalMemory: number;
  cpu: string | null;
  cpuCount: number | null;
  cpuFrequencyMhz: number | null;
  /** 0–100 */
  cpuLoad: number;
  freeHddSpace: number | null;
  totalHddSpace: number | null;
  architecture: string | null;
  boardName: string | null;
  platform: string | null;
}

export interface RouterOsVersion {
  /** e.g. "7.19.4" */
  version: string;
  /** e.g. "stable", "long-term", "testing" */
  channel: string | null;
  buildTime?: string;
}

export interface Interface {
  id: string;
  name: string;
  type: string;
  macAddress: string | null;
  running: boolean;
  disabled: boolean;
  rxBytes: number;
  txBytes: number;
  mtu: number | null;
  comment: string | null;
}

export interface IpAddress {
  id: string;
  address: string;
  network: string | null;
  interface: string;
  disabled: boolean;
  dynamic: boolean;
}

export interface HotspotServer {
  id: string;
  name: string;
  interface: string | null;
  addressPool: string | null;
  /** Hotspot *server* profile name (/ip hotspot profile). */
  profile: string | null;
  disabled: boolean;
  invalid: boolean;
}

export interface HotspotProfile {
  id: string;
  name: string;
  rateLimit: string | null;
  /** null = unlimited */
  sharedUsers: number | null;
  sessionTimeoutSeconds: number | null;
  idleTimeoutSeconds: number | null;
  keepaliveTimeoutSeconds: number | null;
  addressPool: string | null;
  isDefault: boolean;
}

export interface HotspotUser {
  id: string;
  name: string;
  profile: string | null;
  server: string | null;
  disabled: boolean;
  comment: string | null;
  limitUptimeSeconds: number | null;
  limitBytesTotal: number | null;
  uptimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
}

export interface ActiveHotspotUser {
  id: string;
  server: string | null;
  user: string;
  address: string | null;
  macAddress: string | null;
  loginBy: string | null;
  uptimeSeconds: number;
  idleTimeSeconds: number | null;
  sessionTimeLeftSeconds: number | null;
  bytesIn: number;
  bytesOut: number;
}

export interface LogEntry {
  id: string;
  /** Router-local time string as RouterOS reports it (no timezone). */
  time: string;
  topics: string[];
  message: string;
}

export interface HealthSensor {
  name: string;
  value: number | null;
  unit: string | null;
  /** Some sensors (fans, PSUs) report a state such as "ok" or "fail". */
  state: string | null;
}

export interface SystemHealth {
  /** Empty on hardware without sensors (e.g. CHR / x86). */
  sensors: HealthSensor[];
}

export interface UserPolicies {
  username: string;
  group: string;
  policies: string[];
}
