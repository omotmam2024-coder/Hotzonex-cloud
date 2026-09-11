import { MikrotikError, type MikrotikErrorCode, type MikrotikErrorStage } from '../errors.js';
import { DEFAULT_TIMEOUT_MS, clampLogLimit, type MikrotikProvider } from '../provider.js';
import type {
  ActiveHotspotUser,
  ConnectionParams,
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
} from '../types.js';
import { createMockFixtures, type MockFixtures } from './fixtures.js';

export type MockMethod =
  | 'connect'
  | 'testConnection'
  | 'getSystemResource'
  | 'getIdentity'
  | 'getRouterOsVersion'
  | 'getInterfaces'
  | 'getIpAddresses'
  | 'getHotspotServers'
  | 'getHotspotProfiles'
  | 'getHotspotUsers'
  | 'getActiveHotspotUsers'
  | 'getLogs'
  | 'getSystemHealth'
  | 'getCurrentUserPolicies';

export type MockFailure =
  | { kind: 'error'; code: MikrotikErrorCode; stage?: MikrotikErrorStage; detail?: string }
  /** Hangs until the configured timeout, then throws TIMEOUT — like a real dead link. */
  | { kind: 'timeout' }
  /** Returns a reply the parser rejects — surfaces as UNKNOWN "malformed reply". */
  | { kind: 'malformed' };

export interface MockBehavior {
  /** Applied when a session is opened: models offline routers, bad credentials, disabled API. */
  connectFailure?: MockFailure | null;
  methodFailures?: Partial<Record<MockMethod, MockFailure>>;
}

export interface MockOptions {
  latencyMs?: number;
  fixtures?: Partial<MockFixtures>;
  /** Static behaviour, or a function consulted on every call (lets tests and dev tooling flip state live). */
  behavior?: MockBehavior | (() => MockBehavior);
  /** When set, connect() fails with AUTH_FAILED unless params match. */
  acceptedCredentials?: { username: string; password: string };
  now?: () => number;
}

export const MOCK_FAILURE_PRESETS = {
  offline: { kind: 'error', code: 'UNREACHABLE', stage: 'connect', detail: 'ehostunreach' },
  timeout: { kind: 'timeout' },
  authFailed: { kind: 'error', code: 'AUTH_FAILED', stage: 'login', detail: 'invalid user name or password (6)' },
  apiDisabled: { kind: 'error', code: 'API_DISABLED', stage: 'connect', detail: 'connection refused' },
  permissionDenied: { kind: 'error', code: 'PERMISSION_DENIED', stage: 'command', detail: 'not enough permissions (9)' },
  malformed: { kind: 'malformed' },
} as const satisfies Record<string, MockFailure>;

/**
 * In-memory RouterOS stand-in. Deterministic per host (the host seeds the
 * fixtures), with live-varying CPU/memory/uptime so dashboards look real.
 * Records every call so tests can assert that sync never writes.
 */
export class MockMikrotikProvider implements MikrotikProvider {
  readonly fixtures: MockFixtures;
  /** Every method invoked, in order. The mock has no write methods by design (Phase 1). */
  readonly calls: MockMethod[] = [];
  private connected = false;
  private readonly createdAt: number;
  private readonly now: () => number;
  private readonly queued: Array<{ method: MockMethod | '*'; failure: MockFailure; remaining: number }> = [];

  constructor(
    private readonly params: ConnectionParams,
    private readonly options: MockOptions = {},
  ) {
    this.fixtures = createMockFixtures(params.host, options.fixtures);
    this.now = options.now ?? Date.now;
    this.createdAt = this.now();
  }

  /** Make the next `times` calls to `method` (or any method, with "*") fail. */
  failNext(method: MockMethod | '*', failure: MockFailure, times = 1): void {
    this.queued.push({ method, failure, remaining: times });
  }

  private behavior(): MockBehavior {
    const b = this.options.behavior;
    return (typeof b === 'function' ? b() : b) ?? {};
  }

  private get timeoutMs(): number {
    return this.params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async raise(failure: MockFailure, method: MockMethod): Promise<never> {
    switch (failure.kind) {
      case 'timeout':
        await new Promise((r) => setTimeout(r, this.timeoutMs));
        throw new MikrotikError('TIMEOUT', method === 'connect' ? 'connect' : 'command', `no reply within ${this.timeoutMs} ms`);
      case 'malformed':
        throw new MikrotikError('UNKNOWN', 'command', `malformed reply: ${method} returned an unparseable sentence`);
      default:
        throw new MikrotikError(failure.code, failure.stage ?? (method === 'connect' ? 'connect' : 'command'), failure.detail ?? null);
    }
  }

  private takeQueued(method: MockMethod): MockFailure | null {
    const idx = this.queued.findIndex((q) => q.method === method || q.method === '*');
    if (idx === -1) return null;
    const entry = this.queued[idx];
    if (!entry) return null;
    entry.remaining -= 1;
    if (entry.remaining <= 0) this.queued.splice(idx, 1);
    return entry.failure;
  }

  private async step(method: MockMethod): Promise<void> {
    this.calls.push(method);
    const latency = this.options.latencyMs ?? 0;
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    const queued = this.takeQueued(method);
    if (queued) await this.raise(queued, method);
    const failure = this.behavior().methodFailures?.[method];
    if (failure) await this.raise(failure, method);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.step('connect');
    const failure = this.behavior().connectFailure;
    if (failure) await this.raise(failure, 'connect');
    const expected = this.options.acceptedCredentials;
    if (expected && (expected.username !== this.params.username || expected.password !== this.params.password)) {
      throw new MikrotikError('AUTH_FAILED', 'login', 'invalid user name or password (6)');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  private async read(method: MockMethod): Promise<void> {
    await this.connect();
    const failure = this.behavior().connectFailure;
    if (failure) {
      // Router went away mid-session.
      this.connected = false;
      await this.raise(failure, method);
    }
    await this.step(method);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = this.now();
    await this.read('testConnection');
    return {
      latencyMs: Math.max(this.options.latencyMs ?? 0, this.now() - started),
      identity: this.fixtures.identity,
      routerOsVersion: this.fixtures.version,
      boardName: this.fixtures.boardName,
      architecture: this.fixtures.architecture,
    };
  }

  async getSystemResource(): Promise<SystemResource> {
    await this.read('getSystemResource');
    const f = this.fixtures;
    const elapsed = Math.floor((this.now() - this.createdAt) / 1000);
    const minutes = this.now() / 60000;
    const wave = Math.sin(minutes / 7) * 8 + Math.sin(minutes / 1.3) * 3;
    const cpuLoad = Math.round(Math.min(100, Math.max(0, f.baseCpuLoad + wave)));
    const usedFraction = 0.35 + Math.sin(minutes / 11) * 0.05;
    return {
      uptimeSeconds: f.initialUptimeSeconds + elapsed,
      version: `${f.version} (${f.channel})`,
      buildTime: f.buildTime,
      freeMemory: Math.round(f.totalMemory * (1 - usedFraction)),
      totalMemory: f.totalMemory,
      cpu: f.cpu,
      cpuCount: f.cpuCount,
      cpuFrequencyMhz: f.cpuFrequencyMhz,
      cpuLoad,
      freeHddSpace: Math.round(f.totalHddSpace * 0.62),
      totalHddSpace: f.totalHddSpace,
      architecture: f.architecture,
      boardName: f.boardName,
      platform: f.platform,
    };
  }

  async getIdentity(): Promise<{ name: string }> {
    await this.read('getIdentity');
    return { name: this.fixtures.identity };
  }

  async getRouterOsVersion(): Promise<RouterOsVersion> {
    await this.read('getRouterOsVersion');
    return { version: this.fixtures.version, channel: this.fixtures.channel, buildTime: this.fixtures.buildTime };
  }

  async getInterfaces(): Promise<Interface[]> {
    await this.read('getInterfaces');
    const growth = Math.floor((this.now() - this.createdAt) / 1000) * 125_000;
    return this.fixtures.interfaces.map((i) =>
      i.running ? { ...i, rxBytes: i.rxBytes + growth, txBytes: i.txBytes + Math.floor(growth / 3) } : { ...i },
    );
  }

  async getIpAddresses(): Promise<IpAddress[]> {
    await this.read('getIpAddresses');
    return this.fixtures.ipAddresses.map((a) => ({ ...a }));
  }

  async getHotspotServers(): Promise<HotspotServer[]> {
    await this.read('getHotspotServers');
    return this.fixtures.hotspotServers.map((s) => ({ ...s }));
  }

  async getHotspotProfiles(): Promise<HotspotProfile[]> {
    await this.read('getHotspotProfiles');
    return this.fixtures.hotspotProfiles.map((p) => ({ ...p }));
  }

  async getHotspotUsers(): Promise<HotspotUser[]> {
    await this.read('getHotspotUsers');
    return this.fixtures.hotspotUsers.map((u) => ({ ...u }));
  }

  async getActiveHotspotUsers(): Promise<ActiveHotspotUser[]> {
    await this.read('getActiveHotspotUsers');
    return this.fixtures.activeUsers.map((u) => ({ ...u }));
  }

  async getLogs(opts?: { limit?: number }): Promise<LogEntry[]> {
    await this.read('getLogs');
    return this.fixtures.logs.slice(-clampLogLimit(opts?.limit)).map((l) => ({ ...l, topics: [...l.topics] }));
  }

  async getSystemHealth(): Promise<SystemHealth> {
    await this.read('getSystemHealth');
    return { sensors: this.fixtures.sensors.map((s) => ({ ...s })) };
  }

  async getCurrentUserPolicies(): Promise<UserPolicies> {
    await this.read('getCurrentUserPolicies');
    return { username: this.params.username, group: this.fixtures.user.group, policies: [...this.fixtures.user.policies] };
  }
}
