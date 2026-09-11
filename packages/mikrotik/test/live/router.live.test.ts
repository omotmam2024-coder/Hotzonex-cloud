/**
 * Live test against a real RouterOS v7 device or CHR VM. Read-only.
 *
 *   MIKROTIK_LIVE=1 MIKROTIK_LIVE_HOST=10.77.0.5 MIKROTIK_LIVE_USER=hotzonex-api \
 *   MIKROTIK_LIVE_PASSWORD=... [MIKROTIK_LIVE_PROTOCOL=api|api_ssl|rest] [MIKROTIK_LIVE_PORT=8728] \
 *   pnpm test:live
 */
import { describe, expect, it } from 'vitest';
import { createProvider } from '../../src/factory.js';
import { REQUIRED_POLICIES } from '../../src/setup-script.js';
import { API_PROTOCOLS, DEFAULT_PORTS, type ApiProtocol, type ConnectionParams } from '../../src/types.js';

const enabled = process.env['MIKROTIK_LIVE'] === '1';

function params(): ConnectionParams {
  const protocol = (process.env['MIKROTIK_LIVE_PROTOCOL'] ?? 'api') as ApiProtocol;
  if (!API_PROTOCOLS.includes(protocol)) throw new Error(`MIKROTIK_LIVE_PROTOCOL must be one of ${API_PROTOCOLS.join(', ')}`);
  const useSsl = protocol === 'api_ssl' || process.env['MIKROTIK_LIVE_SSL'] === '1';
  const host = process.env['MIKROTIK_LIVE_HOST'];
  const username = process.env['MIKROTIK_LIVE_USER'];
  const password = process.env['MIKROTIK_LIVE_PASSWORD'];
  if (!host || !username || !password) throw new Error('MIKROTIK_LIVE_HOST, MIKROTIK_LIVE_USER and MIKROTIK_LIVE_PASSWORD are required');
  return {
    host,
    username,
    password,
    protocol,
    useSsl,
    port: Number(process.env['MIKROTIK_LIVE_PORT'] ?? (useSsl ? DEFAULT_PORTS[protocol].tls : DEFAULT_PORTS[protocol].plain)),
    tls: { rejectUnauthorized: process.env['MIKROTIK_LIVE_TLS_VERIFY'] === '1' },
  };
}

describe.skipIf(!enabled)('live RouterOS device (read-only)', () => {
  it('connects and reads everything Phase 1 uses', async () => {
    const p = params();
    const provider = createProvider(p.protocol === 'rest' ? 'rest' : 'api', p);
    try {
      const test = await provider.testConnection();
      expect(test.routerOsVersion).toMatch(/^7\./);
      const resource = await provider.getSystemResource();
      expect(resource.totalMemory).toBeGreaterThan(0);
      await provider.getInterfaces();
      await provider.getIpAddresses();
      await provider.getHotspotServers();
      await provider.getHotspotProfiles();
      await provider.getSystemHealth();
      await provider.getLogs({ limit: 5 });
      const policies = await provider.getCurrentUserPolicies();
      for (const required of REQUIRED_POLICIES[p.protocol]) expect(policies.policies).toContain(required);
    } finally {
      await provider.disconnect();
    }
  });
});
