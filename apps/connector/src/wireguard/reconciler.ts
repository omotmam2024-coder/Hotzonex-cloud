import type { Logger } from '../logger.js';
import type { ConnectorStore } from '../store/store.js';
import type { WgManager } from './manager.js';

/** The router pool. Peers inside it belong to Hotzonex; anything else on the interface is left alone. */
const POOL = /^10\.77\.(\d{1,3})\.(\d{1,3})\/32$/;
const SERVER = '10.77.0.1/32';

export function isPoolAddress(allowedIp: string): boolean {
  return POOL.test(allowedIp) && allowedIp !== SERVER;
}

/**
 * Makes the VPS WireGuard peers match the routers in the database, then
 * copies each router's latest handshake back so the UI can show tunnel state.
 * Declarative and idempotent: safe after a VPS reboot that dropped all peers.
 * Only peers whose allowed-ip is in the router pool are ever removed.
 */
export class WgReconciler {
  constructor(
    private readonly store: ConnectorStore,
    private readonly wg: WgManager,
    private readonly log: Logger,
  ) {}

  async reconcile(): Promise<{ added: number; updated: number; removed: number; handshakes: number }> {
    const desired = await this.store.wgPeers();
    const actual = await this.wg.listPeers();
    const actualByKey = new Map(actual.map((p) => [p.publicKey, p]));
    const desiredKeys = new Set(desired.map((d) => d.wg_public_key));
    let added = 0;
    let updated = 0;
    let removed = 0;

    for (const d of desired) {
      const want = `${d.wg_address}/32`;
      const have = actualByKey.get(d.wg_public_key);
      if (!have) {
        await this.wg.setPeer(d.wg_public_key, d.wg_address);
        added++;
      } else if (have.allowedIps.length !== 1 || have.allowedIps[0] !== want) {
        await this.wg.setPeer(d.wg_public_key, d.wg_address);
        updated++;
      }
    }

    for (const peer of actual) {
      if (!desiredKeys.has(peer.publicKey) && peer.allowedIps.length > 0 && peer.allowedIps.every(isPoolAddress)) {
        await this.wg.removePeer(peer.publicKey);
        removed++;
      }
    }

    const after = added + updated > 0 ? await this.wg.listPeers() : actual;
    const handshakes = await this.store.recordHandshakes(
      after
        .filter((p) => desiredKeys.has(p.publicKey))
        .map((p) => ({ public_key: p.publicKey, at: p.latestHandshake ? p.latestHandshake.toISOString() : null })),
    );
    if (added + updated + removed > 0) this.log.info({ added, updated, removed }, 'wireguard peers reconciled');
    return { added, updated, removed, handshakes };
  }
}
