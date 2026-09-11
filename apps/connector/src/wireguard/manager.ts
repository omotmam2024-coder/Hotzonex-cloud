import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WG_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface WgPeer {
  publicKey: string;
  allowedIps: string[];
  latestHandshake: Date | null;
}

/** What the connector needs from the VPS WireGuard interface. */
export interface WgManager {
  readonly kind: 'wg' | 'simulated';
  listPeers(): Promise<WgPeer[]>;
  setPeer(publicKey: string, address: string): Promise<void>;
  removePeer(publicKey: string): Promise<void>;
}

export class WgError extends Error {
  override readonly name = 'WgError';
}

/** Parse `wg show <iface> dump`: first line is the interface, then one tab-separated line per peer. */
export function parseWgDump(output: string): WgPeer[] {
  const lines = output.trim().split('\n').filter(Boolean);
  return lines.slice(1).map((line) => {
    const [publicKey = '', , , allowed = '', handshake = '0'] = line.split('\t');
    const epoch = Number(handshake);
    return {
      publicKey,
      allowedIps: allowed === '(none)' || allowed === '' ? [] : allowed.split(','),
      latestHandshake: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : null,
    };
  });
}

/**
 * Drives the real interface with the `wg` tool (wireguard-tools). Needs
 * CAP_NET_ADMIN — see docs/RUNBOOK.md. Arguments are validated and passed
 * without a shell.
 */
export class WgCliManager implements WgManager {
  readonly kind = 'wg' as const;

  constructor(private readonly iface: string, private readonly bin = 'wg') {
    if (!/^[a-zA-Z0-9_.-]{1,15}$/.test(iface)) throw new WgError(`invalid interface name ${iface}`);
  }

  private async wg(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.bin, args, { timeout: 10_000 });
      return stdout;
    } catch (error) {
      const e = error as NodeJS.ErrnoException & { stderr?: string };
      if (e.code === 'ENOENT') throw new WgError('the `wg` tool is not installed (apt install wireguard-tools)', { cause: error });
      throw new WgError(`wg ${args[0] ?? ''} failed: ${(e.stderr ?? e.message).trim().slice(0, 200)}`, { cause: error });
    }
  }

  async listPeers(): Promise<WgPeer[]> {
    return parseWgDump(await this.wg(['show', this.iface, 'dump']));
  }

  async setPeer(publicKey: string, address: string): Promise<void> {
    if (!WG_KEY.test(publicKey) || !IPV4.test(address)) throw new WgError('refusing to set an invalid peer');
    await this.wg(['set', this.iface, 'peer', publicKey, 'allowed-ips', `${address}/32`]);
  }

  async removePeer(publicKey: string): Promise<void> {
    if (!WG_KEY.test(publicKey)) throw new WgError('refusing to remove an invalid peer');
    await this.wg(['set', this.iface, 'peer', publicKey, 'remove']);
  }
}

/**
 * MOCK: used only with MIKROTIK_PROVIDER=mock. Pretends every configured peer
 * dialled in just now, so the onboarding wizard can be exercised without a
 * VPS. The UI labels the connector as running in mock mode.
 */
export class SimulatedWgManager implements WgManager {
  readonly kind = 'simulated' as const;
  private readonly peers = new Map<string, string[]>();

  async listPeers(): Promise<WgPeer[]> {
    return [...this.peers].map(([publicKey, allowedIps]) => ({ publicKey, allowedIps, latestHandshake: new Date() }));
  }

  async setPeer(publicKey: string, address: string): Promise<void> {
    this.peers.set(publicKey, [`${address}/32`]);
  }

  async removePeer(publicKey: string): Promise<void> {
    this.peers.delete(publicKey);
  }
}
