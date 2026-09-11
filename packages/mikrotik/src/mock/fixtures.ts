import type {
  ActiveHotspotUser,
  HealthSensor,
  HotspotProfile,
  HotspotServer,
  HotspotUser,
  Interface,
  IpAddress,
  LogEntry,
} from '../types.js';

export interface MockFixtures {
  identity: string;
  boardName: string;
  architecture: string;
  platform: string;
  cpu: string;
  cpuCount: number;
  cpuFrequencyMhz: number;
  version: string;
  channel: string;
  buildTime: string;
  totalMemory: number;
  totalHddSpace: number;
  /** Seconds the router had been up when the mock was created. */
  initialUptimeSeconds: number;
  /** Baseline CPU load; the mock varies load around it over time. */
  baseCpuLoad: number;
  interfaces: Interface[];
  ipAddresses: IpAddress[];
  hotspotServers: HotspotServer[];
  hotspotProfiles: HotspotProfile[];
  hotspotUsers: HotspotUser[];
  activeUsers: ActiveHotspotUser[];
  logs: LogEntry[];
  sensors: HealthSensor[];
  user: { group: string; policies: string[] };
}

/** Small deterministic PRNG (mulberry32) so the same seed yields the same router. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOARDS = [
  { boardName: 'hAP ax^3', architecture: 'arm64', platform: 'MikroTik', cpu: 'ARM64', cpuCount: 4, mhz: 1800, mem: 1024 },
  { boardName: 'RB5009UG+S+', architecture: 'arm64', platform: 'MikroTik', cpu: 'ARM64', cpuCount: 4, mhz: 1400, mem: 1024 },
  { boardName: 'hEX S', architecture: 'mmips', platform: 'MikroTik', cpu: 'MIPS 1004Kc V2.15', cpuCount: 4, mhz: 880, mem: 256 },
  { boardName: 'CCR2004-16G-2S+', architecture: 'arm64', platform: 'MikroTik', cpu: 'ARM64', cpuCount: 4, mhz: 1700, mem: 4096 },
] as const;

function mac(rand: () => number): string {
  const bytes = [0x48, 0xa9, 0x8a, ...Array.from({ length: 3 }, () => Math.floor(rand() * 256))];
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export function createMockFixtures(seed: string, overrides: Partial<MockFixtures> = {}): MockFixtures {
  const rand = seededRandom(seed);
  const board = BOARDS[Math.floor(rand() * BOARDS.length)] ?? BOARDS[0];
  const suffix = seed.replace(/[^0-9a-z]/gi, '').slice(-4) || '0001';
  const mb = 1024 * 1024;

  const interfaces: Interface[] = [
    { id: '*1', name: 'ether1', type: 'ether', macAddress: mac(rand), running: true, disabled: false, rxBytes: Math.floor(rand() * 9e11), txBytes: Math.floor(rand() * 2e11), mtu: 1500, comment: 'Starlink WAN' },
    { id: '*2', name: 'ether2', type: 'ether', macAddress: mac(rand), running: true, disabled: false, rxBytes: Math.floor(rand() * 2e11), txBytes: Math.floor(rand() * 8e11), mtu: 1500, comment: null },
    { id: '*3', name: 'ether3', type: 'ether', macAddress: mac(rand), running: false, disabled: false, rxBytes: 0, txBytes: 0, mtu: 1500, comment: null },
    { id: '*4', name: 'wifi1', type: 'wifi', macAddress: mac(rand), running: true, disabled: false, rxBytes: Math.floor(rand() * 3e11), txBytes: Math.floor(rand() * 9e11), mtu: 1500, comment: 'Hotspot 2.4 GHz' },
    { id: '*5', name: 'bridge-hotspot', type: 'bridge', macAddress: mac(rand), running: true, disabled: false, rxBytes: Math.floor(rand() * 5e11), txBytes: Math.floor(rand() * 1e12), mtu: 1500, comment: null },
    { id: '*6', name: 'hotzonex-wg', type: 'wg', macAddress: null, running: true, disabled: false, rxBytes: Math.floor(rand() * 5e7), txBytes: Math.floor(rand() * 5e7), mtu: 1420, comment: 'Hotzonex Cloud tunnel' },
  ];

  const ipAddresses: IpAddress[] = [
    { id: '*1', address: '100.64.12.34/10', network: '100.64.0.0', interface: 'ether1', disabled: false, dynamic: true },
    { id: '*2', address: '10.5.50.1/24', network: '10.5.50.0', interface: 'bridge-hotspot', disabled: false, dynamic: false },
  ];

  const hotspotServers: HotspotServer[] = [
    { id: '*1', name: 'hotspot1', interface: 'bridge-hotspot', addressPool: 'hs-pool-1', profile: 'hsprof1', disabled: false, invalid: false },
  ];
  if (rand() > 0.5) {
    hotspotServers.push({ id: '*2', name: 'hotspot-guest', interface: 'ether2', addressPool: 'hs-pool-2', profile: 'hsprof1', disabled: true, invalid: false });
  }

  const hotspotProfiles: HotspotProfile[] = [
    { id: '*0', name: 'default', rateLimit: null, sharedUsers: 1, sessionTimeoutSeconds: null, idleTimeoutSeconds: null, keepaliveTimeoutSeconds: 120, addressPool: null, isDefault: true },
    { id: '*1', name: '1hr-512k', rateLimit: '512k/512k', sharedUsers: 1, sessionTimeoutSeconds: 3600, idleTimeoutSeconds: 300, keepaliveTimeoutSeconds: 120, addressPool: null, isDefault: false },
    { id: '*2', name: 'day-2M', rateLimit: '2M/2M', sharedUsers: 1, sessionTimeoutSeconds: 86400, idleTimeoutSeconds: 600, keepaliveTimeoutSeconds: 120, addressPool: null, isDefault: false },
    { id: '*3', name: 'week-5M', rateLimit: '5M/5M', sharedUsers: 2, sessionTimeoutSeconds: 604800, idleTimeoutSeconds: null, keepaliveTimeoutSeconds: 120, addressPool: null, isDefault: false },
  ];

  const hotspotUsers: HotspotUser[] = [
    { id: '*1', name: 'admin-test', profile: 'default', server: 'all', disabled: false, comment: 'counter test', limitUptimeSeconds: null, limitBytesTotal: null, uptimeSeconds: 0, bytesIn: 0, bytesOut: 0 },
    { id: '*2', name: 'guest-4821', profile: '1hr-512k', server: 'hotspot1', disabled: false, comment: null, limitUptimeSeconds: 3600, limitBytesTotal: null, uptimeSeconds: 1260, bytesIn: 48_000_000, bytesOut: 5_300_000 },
  ];

  const activeUsers: ActiveHotspotUser[] = [
    { id: '*A1', server: 'hotspot1', user: 'guest-4821', address: '10.5.50.23', macAddress: mac(rand), loginBy: 'http-chap', uptimeSeconds: 1260, idleTimeSeconds: 4, sessionTimeLeftSeconds: 2340, bytesIn: 48_000_000, bytesOut: 5_300_000 },
  ];

  const logs: LogEntry[] = [
    { id: '*100', time: '08:01:12', topics: ['system', 'info'], message: 'router rebooted' },
    { id: '*101', time: '08:01:40', topics: ['wireguard', 'info'], message: 'hotzonex-wg: peer handshake completed' },
    { id: '*102', time: '09:14:03', topics: ['hotspot', 'info', 'account'], message: 'guest-4821 (10.5.50.23): logged in' },
    { id: '*103', time: '09:20:55', topics: ['system', 'info', 'account'], message: 'user hotzonex-api logged in via api' },
  ];

  const sensors: HealthSensor[] =
    board.architecture === 'mmips'
      ? [{ name: 'voltage', value: 24.1, unit: 'V', state: null }, { name: 'temperature', value: 41, unit: 'C', state: null }]
      : [
          { name: 'cpu-temperature', value: 48, unit: 'C', state: null },
          { name: 'board-temperature1', value: 39, unit: 'C', state: null },
          { name: 'psu1-state', value: null, unit: null, state: 'ok' },
        ];

  return {
    identity: `HZX-${suffix.toUpperCase()}`,
    boardName: board.boardName,
    architecture: board.architecture,
    platform: board.platform,
    cpu: board.cpu,
    cpuCount: board.cpuCount,
    cpuFrequencyMhz: board.mhz,
    version: '7.19.4',
    channel: 'stable',
    buildTime: '2025-07-29 10:21:08',
    totalMemory: board.mem * mb,
    totalHddSpace: 128 * mb,
    initialUptimeSeconds: Math.floor(rand() * 20 * 86400) + 3600,
    baseCpuLoad: Math.floor(rand() * 25) + 5,
    interfaces,
    ipAddresses,
    hotspotServers,
    hotspotProfiles,
    hotspotUsers,
    activeUsers,
    logs,
    sensors,
    user: { group: 'hotzonex-api', policies: ['read', 'write', 'api', 'test'] },
    ...overrides,
  };
}
