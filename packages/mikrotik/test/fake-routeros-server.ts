import net from 'node:net';
import { SentenceDecoder, encodeSentence, parseAttributeWord } from '../src/api/sentence.js';

type Row = Record<string, string>;

export interface FakeRouterOptions {
  users?: Record<string, { password: string; group: string }>;
  groups?: Record<string, string>;
  /** command path (e.g. "/interface/print") → rows */
  data?: Record<string, Row[]>;
  /** command path → trap message returned instead of data */
  traps?: Record<string, string>;
  /** Accept the TCP connection but never answer anything. */
  silent?: boolean;
  /** Reply to this command with an unknown reply word. */
  malformedFor?: string;
  /** Reply to this command by closing the socket. */
  dropFor?: string;
  /** Send "!empty" before "!done" for empty results (RouterOS ≥ 7.18 behaviour). */
  emitEmpty?: boolean;
  /** Omit .tag in replies (some older builds). */
  untagged?: boolean;
  /** Pretend to be a pre-6.43 router that answers /login with a challenge. */
  legacyLogin?: boolean;
}

export interface FakeRouter {
  port: number;
  /** Every sentence the server received. Lets tests assert what was (not) sent. */
  received: string[][];
  close(): Promise<void>;
}

export async function startFakeRouter(opts: FakeRouterOptions = {}): Promise<FakeRouter> {
  const received: string[][] = [];
  const sockets = new Set<net.Socket>();
  const users = opts.users ?? { 'hotzonex-api': { password: 'CorrectHorseBatteryStaple42', group: 'hotzonex-api' } };
  const groups = opts.groups ?? { 'hotzonex-api': 'read,write,api,test,!local,!telnet,!ssh,!ftp,!reboot,!policy' };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    const decoder = new SentenceDecoder();
    let loggedInAs: string | null = null;

    const reply = (words: string[], tag: string | null): void => {
      const withTag = tag !== null && !opts.untagged ? [...words, `.tag=${tag}`] : words;
      socket.write(encodeSentence(withTag));
    };

    socket.on('data', (chunk: Buffer) => {
      let sentences: string[][];
      try {
        sentences = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const sentence of sentences) {
        received.push(sentence);
        if (opts.silent) continue;
        const [command = '', ...rest] = sentence;
        let tag: string | null = null;
        const params: Row = {};
        const query: Row = {};
        for (const w of rest) {
          if (w.startsWith('.tag=')) tag = w.slice(5);
          else if (w.startsWith('?')) {
            const [k, v = ''] = w.slice(1).split(/=(.*)/s);
            if (k) query[k] = v;
          } else {
            const kv = parseAttributeWord(w);
            if (kv) params[kv[0]] = kv[1];
          }
        }

        if (command === '/quit') {
          socket.end();
          continue;
        }
        if (command === '/login') {
          if (opts.legacyLogin) {
            reply(['!done', '=ret=ebddd18303a54111e2dea05a92ab46b4'], tag);
            continue;
          }
          const user = users[params['name'] ?? ''];
          if (user && user.password === params['password']) {
            loggedInAs = params['name'] ?? null;
            reply(['!done'], tag);
          } else {
            reply(['!trap', '=message=invalid user name or password (6)'], tag);
            reply(['!done'], tag);
          }
          continue;
        }
        if (!loggedInAs) {
          socket.write(encodeSentence(['!fatal', 'not logged in']));
          socket.end();
          continue;
        }
        if (opts.dropFor === command) {
          socket.destroy();
          continue;
        }
        if (opts.malformedFor === command) {
          reply(['!bogus', '=x=y'], tag);
          continue;
        }
        const trap = opts.traps?.[command];
        if (trap) {
          reply(['!trap', `=message=${trap}`], tag);
          reply(['!done'], tag);
          continue;
        }

        let rows: Row[] | undefined;
        if (command === '/user/print') {
          rows = Object.entries(users).map(([name, u], i) => ({ '.id': `*${i + 1}`, name, group: u.group }));
        } else if (command === '/user/group/print') {
          rows = Object.entries(groups).map(([name, policy], i) => ({ '.id': `*${i + 1}`, name, policy }));
        } else {
          rows = opts.data?.[command];
        }
        if (!rows) {
          reply(['!trap', '=category=0', '=message=no such command prefix'], tag);
          reply(['!done'], tag);
          continue;
        }
        const filtered = rows.filter((r) => Object.entries(query).every(([k, v]) => r[k] === v));
        const proplist = params['.proplist']?.split(',');
        if (filtered.length === 0 && opts.emitEmpty) reply(['!empty'], tag);
        for (const row of filtered) {
          const entries = Object.entries(row).filter(([k]) => !proplist || proplist.includes(k));
          reply(['!re', ...entries.map(([k, v]) => `=${k}=${v}`)], tag);
        }
        reply(['!done'], tag);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake router failed to bind');

  return {
    port: address.port,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A port on 127.0.0.1 with nothing listening — connecting yields ECONNREFUSED. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

export const RESOURCE_ROW: Row = {
  uptime: '2w1d3h4m5s',
  version: '7.19.4 (stable)',
  'build-time': '2025-07-29 10:21:08',
  'free-memory': '805306368',
  'total-memory': '1073741824',
  cpu: 'ARM64',
  'cpu-count': '4',
  'cpu-frequency': '1800',
  'cpu-load': '7',
  'free-hdd-space': '90000000',
  'total-hdd-space': '134217728',
  'architecture-name': 'arm64',
  'board-name': 'hAP ax^3',
  platform: 'MikroTik',
};

export const STANDARD_DATA: Record<string, Row[]> = {
  '/system/resource/print': [RESOURCE_ROW],
  '/system/identity/print': [{ name: 'Lologo-Gate' }],
  '/interface/print': [
    { '.id': '*1', name: 'ether1', type: 'ether', 'mac-address': '48:A9:8A:00:00:01', running: 'true', disabled: 'false', 'rx-byte': '123456789', 'tx-byte': '987654', mtu: '1500' },
    { '.id': '*6', name: 'hotzonex-wg', type: 'wg', running: 'true', disabled: 'false', 'rx-byte': '1000', 'tx-byte': '2000', mtu: '1420', comment: 'Hotzonex Cloud tunnel' },
  ],
  '/ip/address/print': [{ '.id': '*1', address: '10.5.50.1/24', network: '10.5.50.0', interface: 'bridge', disabled: 'false', dynamic: 'false' }],
  '/ip/hotspot/print': [{ '.id': '*1', name: 'hotspot1', interface: 'bridge', 'address-pool': 'hs-pool-1', profile: 'hsprof1', disabled: 'false', invalid: 'false' }],
  '/ip/hotspot/user/profile/print': [
    { '.id': '*0', name: 'default', 'shared-users': '1', 'keepalive-timeout': '2m', default: 'true' },
    { '.id': '*1', name: '1hr-512k', 'rate-limit': '512k/512k', 'shared-users': 'unlimited', 'session-timeout': '1h', 'idle-timeout': 'none' },
  ],
  '/ip/hotspot/user/print': [],
  '/ip/hotspot/active/print': [],
  '/log/print': Array.from({ length: 5 }, (_, i) => ({ '.id': `*${i}`, time: `10:00:0${i}`, topics: 'system,info', message: `line ${i}` })),
  '/system/health/print': [
    { '.id': '*1', name: 'cpu-temperature', value: '47', type: 'C' },
    { '.id': '*2', name: 'psu1-state', value: 'ok', type: '' },
  ],
};
