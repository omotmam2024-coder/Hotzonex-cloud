export type RouterProtocol = 'API' | 'API_SSL' | 'REST';

export type ProviderStatus = {
  ok: boolean;
  status: 'CONNECTED' | 'ERROR';
  message: string;
  identity?: string;
  board?: string;
  architecture?: string;
  routerOsVersion?: string;
  cpu?: string;
  memory?: string;
  uptime?: string;
  publicIp?: string;
};

export interface MikrotikProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<ProviderStatus>;
  getSystemResource(): Promise<Record<string, unknown>>;
  getRouterIdentity(): Promise<string>;
  getRouterVersion(): Promise<string>;
  getInterfaces(): Promise<Array<Record<string, unknown>>>;
  getIpAddresses(): Promise<Array<Record<string, unknown>>>;
  getHotspotServers(): Promise<Array<Record<string, unknown>>>;
  getHotspotProfiles(): Promise<Array<Record<string, unknown>>>;
  getHotspotUsers(): Promise<Array<Record<string, unknown>>>;
  getActiveHotspotUsers(): Promise<Array<Record<string, unknown>>>;
  createHotspotUser(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateHotspotUser(username: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteHotspotUser(username: string): Promise<void>;
  enableHotspotUser(username: string): Promise<void>;
  disableHotspotUser(username: string): Promise<void>;
  disconnectHotspotUser(username: string): Promise<void>;
  getUserSessions(username: string): Promise<Array<Record<string, unknown>>>;
  getInterfaceTraffic(): Promise<Array<Record<string, unknown>>>;
  getSystemHealth(): Promise<Record<string, unknown>>;
  getLogs(): Promise<Array<Record<string, unknown>>>;
  executeCommand(command: string): Promise<Record<string, unknown>>;
}

export class MockMikrotikProvider implements MikrotikProvider {
  private isConnected = false;

  async connect() {
    this.isConnected = true;
  }

  async disconnect() {
    this.isConnected = false;
  }

  async testConnection(): Promise<ProviderStatus> {
    return {
      ok: true,
      status: 'CONNECTED',
      message: 'Mock MikroTik adapter connected successfully.',
      identity: 'Hotzonex Demo Router',
      board: 'x86',
      architecture: 'x86_64',
      routerOsVersion: '7.14.3',
      cpu: '20%',
      memory: '60%',
      uptime: '5d 12h',
      publicIp: '203.0.113.10'
    };
  }

  async getSystemResource() {
    return { cpu: '22%', memory: '58%', uptime: '5d 12h' };
  }

  async getRouterIdentity() {
    return 'Hotzonex Demo Router';
  }

  async getRouterVersion() {
    return '7.14.3';
  }

  async getInterfaces() {
    return [
      { name: 'ether1', type: 'ether', status: 'up', bytesIn: 1000, bytesOut: 1000 },
      { name: 'wlan1', type: 'wireless', status: 'up', bytesIn: 500, bytesOut: 500 }
    ];
  }

  async getIpAddresses() {
    return [
      { address: '192.168.88.1/24', interface: 'ether1' },
      { address: '10.0.0.1/24', interface: 'wlan1' }
    ];
  }

  async getHotspotServers() {
    return [
      { name: 'hotspot1', address: '10.0.0.1', profile: 'default', enabled: true }
    ];
  }

  async getHotspotProfiles() {
    return [
      { name: 'default', rateLimit: '1M/1M', sessionTimeout: '1h', sharedUsers: 1 },
      { name: 'premium', rateLimit: '10M/10M', sessionTimeout: '1d', sharedUsers: 3 }
    ];
  }

  async getHotspotUsers() {
    return [
      { username: 'demo-user', profile: 'default', disabled: false },
      { username: 'demo-admin', profile: 'premium', disabled: false }
    ];
  }

  async getActiveHotspotUsers() {
    return [
      { username: 'demo-user', ipAddress: '10.0.0.12', macAddress: 'AA:BB:CC:DD:EE:FF', uptime: 3600 }
    ];
  }

  async createHotspotUser(input: Record<string, unknown>) {
    return { ...input, created: true };
  }

  async updateHotspotUser(username: string, input: Record<string, unknown>) {
    return { username, ...input, updated: true };
  }

  async deleteHotspotUser(username: string) {
    return Promise.resolve();
  }

  async enableHotspotUser(username: string) {
    return Promise.resolve();
  }

  async disableHotspotUser(username: string) {
    return Promise.resolve();
  }

  async disconnectHotspotUser(username: string) {
    return Promise.resolve();
  }

  async getUserSessions(username: string) {
    return [{ username, ipAddress: '10.0.0.12', upload: 0, download: 0 }];
  }

  async getInterfaceTraffic() {
    return [{ name: 'ether1', bytesIn: 10000, bytesOut: 12000 }];
  }

  async getSystemHealth() {
    return { cpu: '22%', memory: '58%', health: 'HEALTHY' };
  }

  async getLogs() {
    return [{ message: 'Mock log line', timestamp: new Date().toISOString() }];
  }

  async executeCommand(command: string) {
    return { command, ok: true };
  }
}

export class RealMikrotikApiProvider implements MikrotikProvider {
  async connect(): Promise<void> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async disconnect(): Promise<void> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async testConnection(): Promise<ProviderStatus> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getSystemResource(): Promise<Record<string, unknown>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getRouterIdentity(): Promise<string> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getRouterVersion(): Promise<string> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getInterfaces(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getIpAddresses(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getHotspotServers(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getHotspotProfiles(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getHotspotUsers(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getActiveHotspotUsers(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async createHotspotUser(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async updateHotspotUser(username: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async deleteHotspotUser(username: string): Promise<void> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async enableHotspotUser(username: string): Promise<void> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async disableHotspotUser(username: string): Promise<void> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async disconnectHotspotUser(username: string): Promise<void> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getUserSessions(username: string): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getInterfaceTraffic(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getSystemHealth(): Promise<Record<string, unknown>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async getLogs(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real API provider is not implemented yet.');
  }

  async executeCommand(command: string): Promise<Record<string, unknown>> {
    throw new Error('Real API provider is not implemented yet.');
  }
}

export class RealMikrotikRestProvider implements MikrotikProvider {
  async connect(): Promise<void> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async disconnect(): Promise<void> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async testConnection(): Promise<ProviderStatus> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getSystemResource(): Promise<Record<string, unknown>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getRouterIdentity(): Promise<string> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getRouterVersion(): Promise<string> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getInterfaces(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getIpAddresses(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getHotspotServers(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getHotspotProfiles(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getHotspotUsers(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getActiveHotspotUsers(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async createHotspotUser(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async updateHotspotUser(username: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async deleteHotspotUser(username: string): Promise<void> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async enableHotspotUser(username: string): Promise<void> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async disableHotspotUser(username: string): Promise<void> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async disconnectHotspotUser(username: string): Promise<void> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getUserSessions(username: string): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getInterfaceTraffic(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getSystemHealth(): Promise<Record<string, unknown>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async getLogs(): Promise<Array<Record<string, unknown>>> {
    throw new Error('Real REST provider is not implemented yet.');
  }

  async executeCommand(command: string): Promise<Record<string, unknown>> {
    throw new Error('Real REST provider is not implemented yet.');
  }
}
