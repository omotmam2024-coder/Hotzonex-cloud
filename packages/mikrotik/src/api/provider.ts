import { MikrotikError } from '../errors.js';
import {
  parsePolicyList,
  parseVersion,
  requireString,
  toActiveHotspotUser,
  toHealthSensors,
  toHotspotProfile,
  toHotspotServer,
  toHotspotUser,
  toInterface,
  toIpAddress,
  toLogEntry,
  toSystemResource,
  type RawRecord,
} from '../parse.js';
import { DEFAULT_TIMEOUT_MS, clampLogLimit, type MikrotikProvider, type RemoteAccessWriter } from '../provider.js';
import { WG_INTERFACE_NAME, WG_MENU, type RemoteAccessStep } from '../setup-script.js';
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
import { RouterosApiClient, type ApiCommand } from './client.js';

export const PROPLISTS = {
  resource: [
    'uptime', 'version', 'build-time', 'free-memory', 'total-memory', 'cpu', 'cpu-count',
    'cpu-frequency', 'cpu-load', 'free-hdd-space', 'total-hdd-space', 'architecture-name',
    'board-name', 'platform',
  ],
  interface: ['.id', 'name', 'type', 'mac-address', 'running', 'disabled', 'rx-byte', 'tx-byte', 'mtu', 'comment'],
  address: ['.id', 'address', 'network', 'interface', 'disabled', 'dynamic'],
  hotspot: ['.id', 'name', 'interface', 'address-pool', 'profile', 'disabled', 'invalid'],
  hotspotProfile: [
    '.id', 'name', 'rate-limit', 'shared-users', 'session-timeout', 'idle-timeout',
    'keepalive-timeout', 'address-pool', 'default',
  ],
  hotspotUser: [
    '.id', 'name', 'profile', 'server', 'disabled', 'comment', 'limit-uptime', 'limit-bytes-total',
    'uptime', 'bytes-in', 'bytes-out',
  ],
  active: [
    '.id', 'server', 'user', 'address', 'mac-address', 'login-by', 'uptime', 'idle-time',
    'session-time-left', 'bytes-in', 'bytes-out',
  ],
  log: ['.id', 'time', 'topics', 'message'],
} as const;

/** RouterOS binary API over 8728 (plain) or 8729 (api-ssl). */
export class RouterosApiProvider implements MikrotikProvider, RemoteAccessWriter {
  private client: RouterosApiClient | null = null;
  private readonly timeoutMs: number;

  constructor(private readonly params: ConnectionParams) {
    if (params.protocol === 'rest') throw new TypeError('RouterosApiProvider cannot use the REST protocol');
    this.timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.client?.isOpen) return;
    const client = new RouterosApiClient({
      host: this.params.host,
      port: this.params.port,
      tls: this.params.protocol === 'api_ssl',
      timeoutMs: this.timeoutMs,
      ...(this.params.tls ? { tlsOptions: this.params.tls } : {}),
    });
    await client.connect();
    try {
      await client.login(this.params.username, this.params.password);
    } catch (error) {
      client.close();
      throw error;
    }
    this.client = client;
  }

  async disconnect(): Promise<void> {
    this.client?.close();
    this.client = null;
  }

  private async run(cmd: ApiCommand): Promise<RawRecord[]> {
    await this.connect();
    const client = this.client;
    if (!client) throw new MikrotikError('UNREACHABLE', 'connect', 'not connected');
    try {
      return await client.send(cmd);
    } catch (error) {
      if (!client.isOpen) this.client = null;
      throw error;
    }
  }

  private async one(cmd: ApiCommand): Promise<RawRecord> {
    const rows = await this.run(cmd);
    const first = rows[0];
    if (!first) throw new MikrotikError('UNKNOWN', 'command', `malformed reply: ${cmd.command} returned no data`);
    return first;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = performance.now();
    await this.connect();
    const identity = await this.getIdentity();
    const resource = await this.getSystemResource();
    return {
      latencyMs: Math.round(performance.now() - started),
      identity: identity.name,
      routerOsVersion: parseVersion(resource.version).version,
      boardName: resource.boardName,
      architecture: resource.architecture,
    };
  }

  async getSystemResource(): Promise<SystemResource> {
    return toSystemResource(await this.one({ command: '/system/resource/print', proplist: PROPLISTS.resource }));
  }

  async getIdentity(): Promise<{ name: string }> {
    const row = await this.one({ command: '/system/identity/print' });
    return { name: requireString(row, 'name') };
  }

  async getRouterOsVersion(): Promise<RouterOsVersion> {
    const row = await this.one({ command: '/system/resource/print', proplist: ['version', 'build-time'] });
    const parsed = parseVersion(requireString(row, 'version'));
    const buildTime = row['build-time'];
    return buildTime ? { ...parsed, buildTime } : parsed;
  }

  async getInterfaces(): Promise<Interface[]> {
    return (await this.run({ command: '/interface/print', proplist: PROPLISTS.interface })).map(toInterface);
  }

  async getIpAddresses(): Promise<IpAddress[]> {
    return (await this.run({ command: '/ip/address/print', proplist: PROPLISTS.address })).map(toIpAddress);
  }

  async getHotspotServers(): Promise<HotspotServer[]> {
    return (await this.run({ command: '/ip/hotspot/print', proplist: PROPLISTS.hotspot })).map(toHotspotServer);
  }

  async getHotspotProfiles(): Promise<HotspotProfile[]> {
    return (await this.run({ command: '/ip/hotspot/user/profile/print', proplist: PROPLISTS.hotspotProfile })).map(
      toHotspotProfile,
    );
  }

  async getHotspotUsers(): Promise<HotspotUser[]> {
    return (await this.run({ command: '/ip/hotspot/user/print', proplist: PROPLISTS.hotspotUser })).map(toHotspotUser);
  }

  async getActiveHotspotUsers(): Promise<ActiveHotspotUser[]> {
    return (await this.run({ command: '/ip/hotspot/active/print', proplist: PROPLISTS.active })).map(
      toActiveHotspotUser,
    );
  }

  async getLogs(opts?: { limit?: number }): Promise<LogEntry[]> {
    const limit = clampLogLimit(opts?.limit);
    const rows = await this.run({ command: '/log/print', proplist: PROPLISTS.log });
    return rows.slice(-limit).map(toLogEntry);
  }

  async getSystemHealth(): Promise<SystemHealth> {
    return { sensors: toHealthSensors(await this.run({ command: '/system/health/print' })) };
  }

  async getCurrentUserPolicies(): Promise<UserPolicies> {
    const users = await this.run({
      command: '/user/print',
      query: { name: this.params.username },
      proplist: ['name', 'group'],
    });
    const user = users[0];
    if (!user) throw new MikrotikError('NOT_FOUND', 'command', 'logged-in user not visible in /user');
    const group = requireString(user, 'group');
    const groups = await this.run({ command: '/user/group/print', query: { name: group }, proplist: ['name', 'policy'] });
    const groupRow = groups[0];
    if (!groupRow) throw new MikrotikError('NOT_FOUND', 'command', `group "${group}" not visible in /user group`);
    return { username: this.params.username, group, policies: parsePolicyList(groupRow['policy']) };
  }

  /**
   * Applies the tunnel over the connection we already have. Each step looks for
   * its row first and updates it rather than adding a second one, so running
   * this again after a partial failure converges instead of duplicating.
   */
  async enableRemoteAccess(steps: readonly RemoteAccessStep[]): Promise<{ publicKey: string }> {
    for (const step of steps) {
      const existing = await this.run({ command: `${step.menu}/print`, query: step.find, proplist: ['.id'] });
      const id = existing[0]?.['.id'];
      if (id) {
        await this.run({ command: `${step.menu}/set`, params: { '.id': id, ...step.set } });
      } else {
        await this.run({ command: `${step.menu}/add`, params: { ...step.addOnly, ...step.set } });
      }
    }
    const rows = await this.run({
      command: `${WG_MENU}/print`,
      query: { name: WG_INTERFACE_NAME },
      proplist: ['name', 'public-key'],
    });
    const key = rows[0]?.['public-key'];
    if (!key) throw new MikrotikError('UNKNOWN', 'command', 'the router did not report a WireGuard public key');
    return { publicKey: key };
  }
}
