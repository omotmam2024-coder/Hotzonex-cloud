import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_PASSWORD_PATTERN,
  REQUIRED_POLICIES,
  SetupScriptInputError,
  buildRouterSetupScript,
  generateApiPassword,
  parsePastedPublicKey,
  sanitizeComment,
  type SetupScriptInput,
} from '../src/setup-script.js';

const SERVER_KEY = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const base: SetupScriptInput = {
  routerName: 'Lologo Gate',
  generatedAt: new Date('2026-09-11T12:00:00Z'),
  tunnel: { routerAddress: '10.77.0.5', serverAddress: '10.77.0.1', serverPublicKey: SERVER_KEY, endpointHost: 'wg.hotzonex.com', endpointPort: 51820 },
  api: { protocol: 'api', port: 8728, useSsl: false, username: 'hotzonex-api', password: 'A'.repeat(32) },
};

describe('buildRouterSetupScript', () => {
  const script = buildRouterSetupScript(base);

  it('configures an outbound WireGuard peer with keepalive for CGNAT', () => {
    expect(script).toContain(`public-key="${SERVER_KEY}" endpoint-address=wg.hotzonex.com endpoint-port=51820 allowed-address=10.77.0.1/32 persistent-keepalive=25s`);
    expect(script).toContain('/ip address add address=10.77.0.5/32 network=10.77.0.1');
  });

  it('never embeds a router private key (the router generates its own)', () => {
    expect(script).not.toMatch(/private-key=/);
    expect(script).toContain(':put ("HOTZONEX-WG-PUBLIC-KEY="');
  });

  it('creates a restricted group with exactly read,write,api,test', () => {
    expect(script).toContain('/user group add name="hotzonex-api" policy=read,write,api,test');
    for (const forbidden of ['policy,', 'ftp', 'ssh', 'winbox', 'reboot', 'sensitive']) {
      expect(script).not.toMatch(new RegExp(`policy=[^\\n]*\\b${forbidden}\\b`));
    }
  });

  it('limits API login and service to the connector tunnel address', () => {
    expect(script).toContain('address=10.77.0.1/32 comment="Hotzonex Cloud connector"');
    expect(script).toContain('/ip service set api disabled=no port=8728 address=10.77.0.1/32');
    expect(script).toContain('in-interface=hotzonex-wg src-address=10.77.0.1 dst-port=8728');
    expect(script).not.toMatch(/0\.0\.0\.0\/0/);
  });

  it('is idempotent: every add is guarded by a find', () => {
    const adds = script.split('\n').filter((l) => /\/\S+ .*\badd\b/.test(l) && !l.trim().startsWith('#'));
    expect(adds.length).toBeGreaterThan(0);
    for (const line of adds) expect(line.startsWith('  ')).toBe(true);
  });

  it('uses rest-api policy for REST and leaves WebFig reachable', () => {
    const rest = buildRouterSetupScript({ ...base, api: { ...base.api, protocol: 'rest', port: 443, useSsl: true } });
    expect(rest).toContain(`policy=${REQUIRED_POLICIES.rest.join(',')}`);
    expect(rest).toContain('/ip service set www-ssl disabled=no port=443');
    expect(rest).not.toMatch(/set www-ssl[^\n]*address=/);
  });

  it.each([
    ['bad key', { tunnel: { ...base.tunnel, serverPublicKey: 'not-a-key' } }],
    ['bad address', { tunnel: { ...base.tunnel, routerAddress: '10.77.0.999' } }],
    ['same address', { tunnel: { ...base.tunnel, routerAddress: '10.77.0.1' } }],
    ['injection in endpoint', { tunnel: { ...base.tunnel, endpointHost: 'x"; /system reset-configuration' } }],
    ['weak password', { api: { ...base.api, password: 'short' } }],
    ['quote in password', { api: { ...base.api, password: `${'A'.repeat(30)}"x` } }],
    ['bad username', { api: { ...base.api, username: 'Admin User' } }],
  ])('rejects %s', (_label, patch) => {
    expect(() => buildRouterSetupScript({ ...base, ...patch } as SetupScriptInput)).toThrow(SetupScriptInputError);
  });

  it('sanitises the router name used in comments', () => {
    expect(sanitizeComment('Gate"; /system reboot; [x]')).toBe('Gate /system reboot x');
    const s = buildRouterSetupScript({ ...base, routerName: 'Evil" ; /system reboot' });
    expect(s).not.toContain('Evil"');
  });
});

describe('generateApiPassword', () => {
  it('produces 32 alphanumeric chars from a CSPRNG', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pw = generateApiPassword((n) => new Uint8Array(randomBytes(n)));
      expect(pw).toMatch(API_PASSWORD_PATTERN);
      expect(pw).toHaveLength(32);
      seen.add(pw);
    }
    expect(seen.size).toBe(50);
  });
});

describe('parsePastedPublicKey', () => {
  const key = 'kA8y4gUcJ8Tf8p0y5e1F2wdmS3O0Jx1xq6y9E2y3Z0I=';
  it('accepts the marker line, the bare key, or terminal output around it', () => {
    expect(parsePastedPublicKey(`HOTZONEX-WG-PUBLIC-KEY=${key}`)).toBe(key);
    expect(parsePastedPublicKey(`  ${key}\n`)).toBe(key);
    expect(parsePastedPublicKey(`[admin@Gate] > ...\nHOTZONEX-WG-PUBLIC-KEY=${key}\n[admin@Gate] >`)).toBe(key);
  });
  it('rejects anything that is not a WireGuard key', () => {
    expect(parsePastedPublicKey('hello')).toBeNull();
    expect(parsePastedPublicKey('HOTZONEX-WG-PUBLIC-KEY=')).toBeNull();
  });
});
