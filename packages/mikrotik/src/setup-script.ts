/**
 * Generates the one-time RouterOS v7 script an admin pastes into a site
 * router: WireGuard tunnel that dials OUT to the Hotzonex connector, a
 * firewall accept for the API over that tunnel only, and a restricted API
 * group + user. Browser-safe (pure string building, no Node imports).
 *
 * The router generates its own WireGuard private key; the script prints the
 * public key for the admin to paste back. The private key never leaves the router.
 */
import type { ApiProtocol } from './types.js';

export const WG_INTERFACE_NAME = 'hotzonex-wg';
export const WG_PEER_COMMENT = 'Hotzonex Cloud connector';
export const API_FIREWALL_COMMENT = 'Hotzonex Cloud API via tunnel';
export const DEFAULT_API_USERNAME = 'hotzonex-api';
export const DEFAULT_API_GROUP = 'hotzonex-api';
export const PUBLIC_KEY_MARKER = 'HOTZONEX-WG-PUBLIC-KEY=';

/** Policies the Hotzonex API user needs — nothing else (no policy, ftp, ssh, winbox, reboot, sensitive). */
export const REQUIRED_POLICIES: Record<ApiProtocol, readonly string[]> = {
  api: ['read', 'write', 'api', 'test'],
  api_ssl: ['read', 'write', 'api', 'test'],
  rest: ['read', 'write', 'rest-api', 'test'],
};

/** Policies that must NOT be granted; "test permissions" flags them if present. */
export const FORBIDDEN_POLICIES: readonly string[] = [
  'policy', 'ftp', 'ssh', 'telnet', 'winbox', 'web', 'local', 'reboot', 'password', 'sensitive', 'sniff', 'romon',
];

export interface SetupScriptInput {
  routerName: string;
  generatedAt: Date;
  tunnel: {
    /** This router's tunnel address, e.g. "10.77.0.5". */
    routerAddress: string;
    /** Connector's tunnel address, e.g. "10.77.0.1". */
    serverAddress: string;
    serverPublicKey: string;
    endpointHost: string;
    endpointPort: number;
    keepaliveSeconds?: number;
  };
  api: {
    protocol: ApiProtocol;
    port: number;
    /** Only meaningful for REST: https (www-ssl) vs http (www). */
    useSsl: boolean;
    username: string;
    password: string;
    group?: string;
  };
}

export class SetupScriptInputError extends Error {
  override readonly name = 'SetupScriptInputError';
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
export const WG_KEY_PATTERN = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
export const API_USERNAME_PATTERN = /^[a-z][a-z0-9-]{2,31}$/;
export const API_PASSWORD_PATTERN = /^[A-Za-z0-9]{20,64}$/;

function check(condition: boolean, message: string): void {
  if (!condition) throw new SetupScriptInputError(message);
}

/** Strip anything that could break out of a RouterOS quoted string or comment. */
export function sanitizeComment(text: string): string {
  return text.replace(/["\\$;{}[\]\r\n\t?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Generate an API password from a CSPRNG. Alphanumeric only, so it is safe
 * inside a RouterOS quoted string and when pasted into any terminal.
 * 32 chars × log2(56) ≈ 186 bits.
 */
export function generateApiPassword(randomBytes: (n: number) => Uint8Array, length = 32): string {
  check(length >= 20 && length <= 64, 'password length must be 20–64');
  const out: string[] = [];
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) out.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length] as string);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** Extract the router's WireGuard public key from what the admin pasted back. */
export function parsePastedPublicKey(pasted: string): string | null {
  const text = pasted.trim();
  const markerIdx = text.lastIndexOf(PUBLIC_KEY_MARKER);
  const candidate = (markerIdx >= 0 ? text.slice(markerIdx + PUBLIC_KEY_MARKER.length) : text).trim().split(/\s+/)[0] ?? '';
  return WG_KEY_PATTERN.test(candidate) ? candidate : null;
}

function serviceLines(api: SetupScriptInput['api'], server: string): string[] {
  switch (api.protocol) {
    case 'api':
      return [
        '# 5. API service: enabled, reachable ONLY from the Hotzonex connector tunnel address.',
        '#    If other tools on your LAN use the API, add their addresses: address=10.77.0.1/32,192.168.88.0/24',
        `/ip service set api disabled=no port=${api.port} address=${server}/32`,
      ];
    case 'api_ssl':
      return [
        '# 5. API-SSL service: enabled, reachable ONLY from the Hotzonex connector tunnel address.',
        '#    api-ssl needs a certificate assigned first: /ip service set api-ssl certificate=<name>',
        `/ip service set api-ssl disabled=no port=${api.port} address=${server}/32`,
      ];
    case 'rest':
      return api.useSsl
        ? [
            '# 5. REST API over HTTPS (www-ssl). Your WebFig access is left unchanged;',
            '#    the firewall rule above limits the tunnel side to the connector only.',
            '#    www-ssl needs a certificate assigned first: /ip service set www-ssl certificate=<name>',
            `/ip service set www-ssl disabled=no port=${api.port}`,
          ]
        : [
            '# 5. REST API over HTTP (www, RouterOS 7.9+). Traffic stays inside the encrypted WireGuard tunnel.',
            '#    Your WebFig access is left unchanged.',
            `/ip service set www disabled=no port=${api.port}`,
          ];
  }
}

// -----------------------------------------------------------------------------
// The same tunnel, applied over a connection that already works.
//
// A router added on the local network is already reachable with a login that
// works, so remote access needs no pasted script: the connector configures the
// tunnel over that connection. These are the RouterOS menus and fields it
// writes — kept here, with the script, so the command surface stays in one file.
// -----------------------------------------------------------------------------

export const WG_MENU = '/interface/wireguard';
export const WG_PEER_MENU = '/interface/wireguard/peers';
export const IP_ADDRESS_MENU = '/ip/address';
export const FIREWALL_FILTER_MENU = '/ip/firewall/filter';

/** One idempotent step: find a row, then create or update it. */
export interface RemoteAccessStep {
  menu: string;
  /** Identifies an existing row; `add` when nothing matches, otherwise `set`. */
  find: Record<string, string>;
  /** Fields written on both create and update. */
  set: Record<string, string>;
  /** Fields written only on create (RouterOS rejects some of them on set). */
  addOnly?: Record<string, string>;
}

export interface RemoteAccessPlanInput {
  tunnel: SetupScriptInput['tunnel'];
  api: { protocol: ApiProtocol; port: number };
}

/**
 * The steps that make a router reachable over the tunnel: its own WireGuard
 * interface (whose private key it generates and never reveals), the connector
 * as a peer, the point-to-point address, and a firewall accept for the API from
 * the connector only.
 *
 * The restricted API user is deliberately not part of this: the router already
 * has a login that works, and replacing it silently would be a surprise.
 */
export function buildRemoteAccessPlan(input: RemoteAccessPlanInput): RemoteAccessStep[] {
  const { tunnel, api } = input;
  check(IPV4.test(tunnel.routerAddress), 'router tunnel address must be an IPv4 address');
  check(IPV4.test(tunnel.serverAddress), 'server tunnel address must be an IPv4 address');
  check(tunnel.routerAddress !== tunnel.serverAddress, 'router and server tunnel addresses must differ');
  check(WG_KEY_PATTERN.test(tunnel.serverPublicKey), 'server WireGuard public key is not a valid key');
  check(IPV4.test(tunnel.endpointHost) || HOSTNAME.test(tunnel.endpointHost), 'WireGuard endpoint must be a hostname or IPv4 address');
  check(Number.isInteger(tunnel.endpointPort) && tunnel.endpointPort > 0 && tunnel.endpointPort < 65536, 'endpoint port is invalid');
  check(Number.isInteger(api.port) && api.port > 0 && api.port < 65536, 'API port is invalid');
  const keepalive = tunnel.keepaliveSeconds ?? 25;
  check(Number.isInteger(keepalive) && keepalive >= 10 && keepalive <= 120, 'keepalive must be 10–120 seconds');

  const server = tunnel.serverAddress;
  return [
    {
      menu: WG_MENU,
      find: { name: WG_INTERFACE_NAME },
      set: { mtu: '1420', comment: WG_PEER_COMMENT },
      addOnly: { name: WG_INTERFACE_NAME, 'listen-port': '13231' },
    },
    {
      menu: WG_PEER_MENU,
      find: { interface: WG_INTERFACE_NAME, comment: WG_PEER_COMMENT },
      set: {
        'public-key': tunnel.serverPublicKey,
        'endpoint-address': tunnel.endpointHost,
        'endpoint-port': String(tunnel.endpointPort),
        'allowed-address': `${server}/32`,
        'persistent-keepalive': `${keepalive}s`,
      },
      addOnly: { interface: WG_INTERFACE_NAME, comment: WG_PEER_COMMENT },
    },
    {
      menu: IP_ADDRESS_MENU,
      find: { interface: WG_INTERFACE_NAME },
      set: { address: `${tunnel.routerAddress}/32`, network: server },
      addOnly: { interface: WG_INTERFACE_NAME, comment: WG_PEER_COMMENT },
    },
    {
      menu: FIREWALL_FILTER_MENU,
      find: { comment: API_FIREWALL_COMMENT },
      set: {
        chain: 'input',
        action: 'accept',
        protocol: 'tcp',
        'in-interface': WG_INTERFACE_NAME,
        'src-address': server,
        'dst-port': String(api.port),
      },
      addOnly: { comment: API_FIREWALL_COMMENT },
    },
  ];
}

export function buildRouterSetupScript(input: SetupScriptInput): string {
  const { tunnel, api } = input;
  check(IPV4.test(tunnel.routerAddress), 'router tunnel address must be an IPv4 address');
  check(IPV4.test(tunnel.serverAddress), 'server tunnel address must be an IPv4 address');
  check(tunnel.routerAddress !== tunnel.serverAddress, 'router and server tunnel addresses must differ');
  check(WG_KEY_PATTERN.test(tunnel.serverPublicKey), 'server WireGuard public key is not a valid key');
  check(IPV4.test(tunnel.endpointHost) || HOSTNAME.test(tunnel.endpointHost), 'WireGuard endpoint must be a hostname or IPv4 address');
  check(Number.isInteger(tunnel.endpointPort) && tunnel.endpointPort > 0 && tunnel.endpointPort < 65536, 'endpoint port is invalid');
  check(Number.isInteger(api.port) && api.port > 0 && api.port < 65536, 'API port is invalid');
  check(API_USERNAME_PATTERN.test(api.username), 'API username must be 3–32 chars: lowercase letters, digits, dashes');
  check(API_PASSWORD_PATTERN.test(api.password), 'API password must be 20–64 alphanumeric characters');
  const group = api.group ?? DEFAULT_API_GROUP;
  check(API_USERNAME_PATTERN.test(group), 'API group name is invalid');
  const keepalive = tunnel.keepaliveSeconds ?? 25;
  check(Number.isInteger(keepalive) && keepalive >= 10 && keepalive <= 120, 'keepalive must be 10–120 seconds');

  const name = sanitizeComment(input.routerName) || 'router';
  const server = tunnel.serverAddress;
  const policies = REQUIRED_POLICIES[api.protocol].join(',');
  const peerArgs =
    `public-key="${tunnel.serverPublicKey}" endpoint-address=${tunnel.endpointHost} endpoint-port=${tunnel.endpointPort} ` +
    `allowed-address=${server}/32 persistent-keepalive=${keepalive}s`;
  const fwArgs =
    `chain=input action=accept protocol=tcp in-interface=${WG_INTERFACE_NAME} src-address=${server} ` +
    `dst-port=${api.port} comment="${API_FIREWALL_COMMENT}"`;

  const lines = [
    '# ================================================================',
    `# Hotzonex Cloud - onboarding script for router "${name}"`,
    `# Generated ${input.generatedAt.toISOString()} - requires RouterOS v7.`,
    '# Paste into the router terminal (WinBox > New Terminal) and press Enter.',
    '# The router dials OUT to Hotzonex over WireGuard. No inbound port is',
    '# opened on your internet connection and the API is never exposed publicly.',
    '# Safe to run again: existing Hotzonex items are updated, not duplicated.',
    '# ================================================================',
    '{',
    ':if ([:pick [/system resource get version] 0 1] != "7") do={ :error "Hotzonex Cloud requires RouterOS v7" }',
    '',
    '# 1. WireGuard interface. The router generates its own private key; it never leaves the router.',
    `:if ([:len [/interface wireguard find name="${WG_INTERFACE_NAME}"]] = 0) do={`,
    `  /interface wireguard add name="${WG_INTERFACE_NAME}" listen-port=13231 mtu=1420 comment="Hotzonex Cloud tunnel"`,
    '}',
    '',
    '# 2. Hotzonex connector peer. persistent-keepalive keeps the tunnel open through Starlink CGNAT.',
    `:if ([:len [/interface wireguard peers find interface="${WG_INTERFACE_NAME}" comment="${WG_PEER_COMMENT}"]] = 0) do={`,
    `  /interface wireguard peers add interface="${WG_INTERFACE_NAME}" ${peerArgs} comment="${WG_PEER_COMMENT}"`,
    '} else={',
    `  /interface wireguard peers set [find interface="${WG_INTERFACE_NAME}" comment="${WG_PEER_COMMENT}"] ${peerArgs}`,
    '}',
    '',
    '# 3. Point-to-point tunnel address. Does not touch your LAN addressing.',
    `:if ([:len [/ip address find interface="${WG_INTERFACE_NAME}"]] = 0) do={`,
    `  /ip address add address=${tunnel.routerAddress}/32 network=${server} interface="${WG_INTERFACE_NAME}" comment="Hotzonex Cloud tunnel"`,
    '} else={',
    `  /ip address set [find interface="${WG_INTERFACE_NAME}"] address=${tunnel.routerAddress}/32 network=${server}`,
    '}',
    '',
    '# 4. Firewall: accept the API from the connector over the tunnel only, placed before any drop rules.',
    `:if ([:len [/ip firewall filter find comment="${API_FIREWALL_COMMENT}"]] = 0) do={`,
    '  :if ([:len [/ip firewall filter find chain=input]] > 0) do={',
    `    /ip firewall filter add ${fwArgs} place-before=[:pick [/ip firewall filter find chain=input] 0]`,
    '  } else={',
    `    /ip firewall filter add ${fwArgs}`,
    '  }',
    '} else={',
    `  /ip firewall filter set [find comment="${API_FIREWALL_COMMENT}"] ${fwArgs}`,
    '}',
    '',
    ...serviceLines(api, server),
    '',
    `# 6. Restricted API group: ${policies} only. No policy, ftp, ssh, winbox, reboot or sensitive rights.`,
    `:if ([:len [/user group find name="${group}"]] = 0) do={`,
    `  /user group add name="${group}" policy=${policies} comment="Hotzonex Cloud restricted API access"`,
    '} else={',
    `  /user group set [find name="${group}"] policy=${policies}`,
    '}',
    '',
    '# 7. API user, allowed to log in only from the connector tunnel address.',
    `:if ([:len [/user find name="${api.username}"]] = 0) do={`,
    `  /user add name="${api.username}" group="${group}" password="${api.password}" address=${server}/32 comment="Hotzonex Cloud connector"`,
    '} else={',
    `  /user set [find name="${api.username}"] group="${group}" password="${api.password}" address=${server}/32`,
    '}',
    '',
    '# 8. Copy the line printed below back into Hotzonex Cloud.',
    `:put ("${PUBLIC_KEY_MARKER}" . [/interface wireguard get [find name="${WG_INTERFACE_NAME}"] public-key])`,
    '}',
  ];
  return `${lines.join('\n')}\n`;
}
