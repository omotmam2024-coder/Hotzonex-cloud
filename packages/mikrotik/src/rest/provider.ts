import http from 'node:http';
import https from 'node:https';
import { MikrotikError, classifyRouterMessage, classifyTransportError, type MikrotikErrorCode } from '../errors.js';
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
import { PROPLISTS } from '../api/provider.js';
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

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function statusToCode(status: number, detail: string): MikrotikErrorCode {
  const fromMessage = classifyRouterMessage(detail, 'command');
  if (status === 401) return 'AUTH_FAILED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (fromMessage !== 'UNKNOWN') return fromMessage;
  if (status === 404) return 'NOT_FOUND';
  if (status === 400 || status === 406) return 'INVALID_COMMAND';
  return 'UNKNOWN';
}

function toRecord(value: unknown, path: string): RawRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MikrotikError('UNKNOWN', 'command', `malformed reply: ${path} did not return an object`);
  }
  const out: RawRecord = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/** RouterOS v7 REST API over HTTPS (www-ssl) or HTTP (www, 7.9+). */
export class RouterosRestProvider implements MikrotikProvider, RemoteAccessWriter {
  private agent: http.Agent | null = null;
  private readonly timeoutMs: number;

  constructor(private readonly params: ConnectionParams) {
    if (params.protocol !== 'rest') throw new TypeError('RouterosRestProvider requires protocol "rest"');
    this.timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (!this.agent) {
      this.agent = this.params.useSsl
        ? new https.Agent({
            keepAlive: true,
            maxSockets: 1,
            rejectUnauthorized: this.params.tls?.rejectUnauthorized ?? true,
            ...(this.params.tls?.ca ? { ca: this.params.tls.ca } : {}),
          })
        : new http.Agent({ keepAlive: true, maxSockets: 1 });
    }
    // REST is stateless; prove reachability and credentials with the cheapest call.
    await this.request('/system/identity');
  }

  async disconnect(): Promise<void> {
    this.agent?.destroy();
    this.agent = null;
  }

  private request(
    path: string,
    query: Record<string, string> = {},
    write?: { method: 'PUT' | 'PATCH'; body: Record<string, string> },
  ): Promise<unknown> {
    const agent = this.agent;
    if (!agent) return Promise.reject(new MikrotikError('UNREACHABLE', 'connect', 'not connected'));
    const search = new URLSearchParams(query).toString();
    const transport = this.params.useSsl ? https : http;
    const auth = Buffer.from(`${this.params.username}:${this.params.password}`).toString('base64');
    const payload = write ? Buffer.from(JSON.stringify(write.body), 'utf8') : null;

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const req = transport.request(
        {
          host: this.params.host,
          port: this.params.port,
          method: write?.method ?? 'GET',
          path: `/rest${path}${search ? `?${search}` : ''}`,
          agent,
          headers: {
            authorization: `Basic ${auth}`,
            accept: 'application/json',
            ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              req.destroy();
              done(() => reject(new MikrotikError('UNKNOWN', 'command', 'malformed reply: body too large')));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            let parsed: unknown;
            try {
              parsed = body === '' ? null : JSON.parse(body);
            } catch {
              if (status >= 400) {
                done(() => reject(new MikrotikError(statusToCode(status, ''), 'command', `HTTP ${status}`)));
              } else {
                done(() => reject(new MikrotikError('UNKNOWN', 'command', 'malformed reply: body is not JSON')));
              }
              return;
            }
            if (status >= 400) {
              const obj = (parsed ?? {}) as { message?: unknown; detail?: unknown };
              const detail = [obj.message, obj.detail].filter((x) => typeof x === 'string').join(': ');
              const stage = status === 401 ? 'login' : 'command';
              done(() => reject(new MikrotikError(statusToCode(status, detail), stage, detail || `HTTP ${status}`)));
              return;
            }
            done(() => resolve(parsed));
          });
          res.on('error', (err) => done(() => reject(classifyTransportError(err, 'command'))));
        },
      );
      const timer = setTimeout(() => {
        req.destroy();
        done(() => reject(new MikrotikError('TIMEOUT', 'command', `no reply within ${this.timeoutMs} ms`)));
      }, this.timeoutMs);
      req.on('error', (err) =>
        done(() => reject(classifyTransportError(err, this.params.useSsl ? 'tls' : 'connect'))),
      );
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async list(path: string, proplist?: readonly string[], filter: Record<string, string> = {}): Promise<RawRecord[]> {
    if (!this.agent) await this.connect();
    const query = proplist ? { ...filter, '.proplist': proplist.join(',') } : filter;
    const body = await this.request(path, query);
    if (!Array.isArray(body)) throw new MikrotikError('UNKNOWN', 'command', `malformed reply: ${path} did not return a list`);
    return body.map((item) => toRecord(item, path));
  }

  private async object(path: string, proplist?: readonly string[]): Promise<RawRecord> {
    if (!this.agent) await this.connect();
    const body = await this.request(path, proplist ? { '.proplist': proplist.join(',') } : {});
    // Singleton menus come back as an object; some builds wrap them in a one-element array.
    return toRecord(Array.isArray(body) ? body[0] : body, path);
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
    return toSystemResource(await this.object('/system/resource', PROPLISTS.resource));
  }

  async getIdentity(): Promise<{ name: string }> {
    return { name: requireString(await this.object('/system/identity'), 'name') };
  }

  async getRouterOsVersion(): Promise<RouterOsVersion> {
    const row = await this.object('/system/resource', ['version', 'build-time']);
    const parsed = parseVersion(requireString(row, 'version'));
    const buildTime = row['build-time'];
    return buildTime ? { ...parsed, buildTime } : parsed;
  }

  async getInterfaces(): Promise<Interface[]> {
    return (await this.list('/interface', PROPLISTS.interface)).map(toInterface);
  }

  async getIpAddresses(): Promise<IpAddress[]> {
    return (await this.list('/ip/address', PROPLISTS.address)).map(toIpAddress);
  }

  async getHotspotServers(): Promise<HotspotServer[]> {
    return (await this.list('/ip/hotspot', PROPLISTS.hotspot)).map(toHotspotServer);
  }

  async getHotspotProfiles(): Promise<HotspotProfile[]> {
    return (await this.list('/ip/hotspot/user/profile', PROPLISTS.hotspotProfile)).map(toHotspotProfile);
  }

  async getHotspotUsers(): Promise<HotspotUser[]> {
    return (await this.list('/ip/hotspot/user', PROPLISTS.hotspotUser)).map(toHotspotUser);
  }

  async getActiveHotspotUsers(): Promise<ActiveHotspotUser[]> {
    return (await this.list('/ip/hotspot/active', PROPLISTS.active)).map(toActiveHotspotUser);
  }

  async getLogs(opts?: { limit?: number }): Promise<LogEntry[]> {
    const limit = clampLogLimit(opts?.limit);
    return (await this.list('/log', PROPLISTS.log)).slice(-limit).map(toLogEntry);
  }

  async getSystemHealth(): Promise<SystemHealth> {
    if (!this.agent) await this.connect();
    const body = await this.request('/system/health');
    const rows = Array.isArray(body) ? body.map((b) => toRecord(b, '/system/health')) : [toRecord(body, '/system/health')];
    return { sensors: toHealthSensors(rows) };
  }

  async getCurrentUserPolicies(): Promise<UserPolicies> {
    const users = await this.list('/user', ['name', 'group'], { name: this.params.username });
    const user = users[0];
    if (!user) throw new MikrotikError('NOT_FOUND', 'command', 'logged-in user not visible in /user');
    const group = requireString(user, 'group');
    const groups = await this.list('/user/group', ['name', 'policy'], { name: group });
    const groupRow = groups[0];
    if (!groupRow) throw new MikrotikError('NOT_FOUND', 'command', `group "${group}" not visible in /user group`);
    return { username: this.params.username, group, policies: parsePolicyList(groupRow['policy']) };
  }

  /** See RouterosApiProvider.enableRemoteAccess — same steps, over REST. */
  async enableRemoteAccess(steps: readonly RemoteAccessStep[]): Promise<{ publicKey: string }> {
    if (!this.agent) await this.connect();
    for (const step of steps) {
      const existing = await this.list(step.menu, ['.id'], step.find);
      const id = existing[0]?.['.id'];
      // RouterOS REST adds with PUT on the menu and updates with PATCH on the row.
      if (id) await this.request(`${step.menu}/${encodeURIComponent(id)}`, {}, { method: 'PATCH', body: step.set });
      else await this.request(step.menu, {}, { method: 'PUT', body: { ...step.addOnly, ...step.set } });
    }
    const rows = await this.list(WG_MENU, ['name', 'public-key'], { name: WG_INTERFACE_NAME });
    const key = rows[0]?.['public-key'];
    if (!key) throw new MikrotikError('UNKNOWN', 'command', 'the router did not report a WireGuard public key');
    return { publicKey: key };
  }
}
