import type { ConnectorStore } from '../store/store.js';
import type { Keyring } from './keyring.js';

/**
 * Re-encrypt every stored router password with the keyring's current version.
 * Rows that cannot be decrypted with any configured key are counted and left
 * untouched (the operator re-enters those credentials in the UI).
 */
export async function rekeyAll(store: ConnectorStore, keyring: Keyring, batch = 100): Promise<{ rekeyed: number; failed: number }> {
  let rekeyed = 0;
  let failed = 0;
  const skipped = new Set<string>();
  for (;;) {
    const rows = (await store.credentialsForRekey(keyring.currentVersion, batch + skipped.size)).filter((r) => !skipped.has(r.router_id));
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        const plaintext = keyring.decrypt(row.password_ciphertext, row.key_version, row.router_id);
        const { ciphertext, keyVersion } = keyring.encrypt(plaintext, row.router_id);
        if (await store.updateCiphertext(row.router_id, ciphertext, keyVersion, row.key_version)) rekeyed++;
      } catch {
        failed++;
        skipped.add(row.router_id);
      }
    }
  }
  return { rekeyed, failed };
}
