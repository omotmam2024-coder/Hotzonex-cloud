import { RouterOSAPI } from 'node-routeros';
import { fetch, Agent } from 'undici';

const TIMEOUT_MS = 10_000;
// Routers ship self-signed certs; TLS is only used for routers reached on a public IP.
const insecureTls = new Agent({ connect: { rejectUnauthorized: false } });

const UNITS = { w: 604800, d: 86400, h: 3600, m: 60, s: 1, ms: 0 };

/** 5400 -> "1h30m" (RouterOS time syntax) */
export function toRosTime(totalSeconds) {
  let s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (s === 0) return '0s';
  let out = '';
  for (const [u, size] of [['w', 604800], ['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(s / size);
    if (n > 0) { out += `${n}${u}`; s -= n * size; }
  }
  return out;
}

/** "1w2d3h4m5s" | "1d02:03:04" | "00:05:00" | "300" -> seconds */
export function parseRosTime(value) {
  if (value === undefined || value === null || value === '') return 0;
  const str = String(value).trim();
  if (/^\d+$/.test(str)) return Number(str);
  const clock = str.match(/^(?:(\d+)w)?(?:(\d+)d)?(\d{1,2}):(\d{2}):(\d{2})$/);
  if (clock) {
    const [, w = 0, d = 0, h, m, s] = clock;
    return Number(w) * 604800 + Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  let total = 0;
  for (const [, n, u] of str.matchAll(/(\d+)(w|d|h|ms|m|s)/g)) total += Number(n) * UNITS[u];
  return total;
}

class RestClient {
  constructor({ host, port, tls, username, password }) {
    this.base = `${tls ? 'https' : 'http'}://${host}:${port}/rest`;
    this.auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    this.dispatcher = tls ? insecureTls : undefined;
  }

  async req(method, path, body) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new RouterError('offline', `cannot reach ${this.base}: ${e.cause?.code ?? e.message}`);
    }
    const text = await res.text();
    if (res.status === 401) throw new RouterError('auth_failed', 'wrong username or password');
    if (!res.ok) {
      let detail = text;
      try { const j = JSON.parse(text); detail = j.detail ?? j.message ?? text; } catch {}
      throw new RouterError('error', `${method} ${path} → ${res.status}: ${detail}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async connect() { return this; }
  print(path) { return this.req('GET', path).then((r) => (Array.isArray(r) ? r : r ? [r] : [])); }
  add(path, obj) { return this.req('PUT', path, obj); }
  remove(path, id) { return this.req('DELETE', `${path}/${encodeURIComponent(id)}`); }
  async identity() { const [r] = await this.print('/system/resource'); return r ?? {}; }
  async close() {}
}

class ApiClient {
  constructor({ host, port, tls, username, password }) {
    this.api = new RouterOSAPI({
      host, port, user: username, password,
      tls: tls ? { rejectUnauthorized: false } : undefined,
      timeout: TIMEOUT_MS / 1000,
      keepalive: false,
    });
  }

  async connect() {
    try {
      await this.api.connect();
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (/cannot log in|invalid user|password/i.test(msg)) throw new RouterError('auth_failed', 'wrong username or password');
      throw new RouterError('offline', `cannot reach router: ${msg}`);
    }
    return this;
  }

  async write(cmd, params = []) {
    try { return await this.api.write(cmd, params); }
    catch (e) { throw new RouterError('error', `${cmd}: ${e?.message ?? e}`); }
  }

  print(path) { return this.write(`${path}/print`); }
  add(path, obj) { return this.write(`${path}/add`, Object.entries(obj).map(([k, v]) => `=${k}=${v}`)); }
  remove(path, id) { return this.write(`${path}/remove`, [`=.id=${id}`]); }
  async identity() { const [r] = await this.print('/system/resource'); return r ?? {}; }
  async close() { try { if (this.api.connected) await this.api.close(); } catch {} }
}

export class RouterError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/** cfg: { host, port, conn: 'rest'|'api', tls, username, password } */
export async function connectRouter(cfg) {
  const client = cfg.conn === 'api' ? new ApiClient(cfg) : new RestClient(cfg);
  return client.connect();
}

export function defaultPort(conn, tls) {
  if (conn === 'api') return tls ? 8729 : 8728;
  return tls ? 443 : 80;
}
