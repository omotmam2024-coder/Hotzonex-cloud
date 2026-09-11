/**
 * Re-encrypt every stored router password with the current ENCRYPTION_KEY_VERSION.
 *
 * Rotation procedure (docs/RUNBOOK.md):
 *   1. Move the old key into ENCRYPTION_KEYS_RETIRED ("<old version>:<old key>").
 *   2. Set ENCRYPTION_KEY to a new key and bump ENCRYPTION_KEY_VERSION.
 *   3. Restart the connector, then run: pnpm --filter @hotzonex/connector rekey
 *   4. When it reports 0 failures, remove the retired key.
 */
import { loadConfig, parseRetiredKeys } from '../config.js';
import { Keyring } from '../crypto/keyring.js';
import { rekeyAll } from '../crypto/rekey.js';
import { ConnectorStore } from '../store/store.js';
import { SupabaseTransport } from '../store/supabase-transport.js';

try {
  const config = loadConfig();
  const keyring = Keyring.fromBase64(
    { version: config.ENCRYPTION_KEY_VERSION, key: config.ENCRYPTION_KEY },
    parseRetiredKeys(config.ENCRYPTION_KEYS_RETIRED),
  );
  const store = new ConnectorStore(new SupabaseTransport(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, config.CONNECTOR_ID));
  const { rekeyed, failed } = await rekeyAll(store, keyring);
  process.stdout.write(`Re-encrypted ${rekeyed} credential(s) with key version ${keyring.currentVersion}.\n`);
  if (failed > 0) {
    process.stdout.write(`${failed} credential(s) could not be decrypted with any configured key; re-enter them in the UI.\n`);
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`rekey failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
