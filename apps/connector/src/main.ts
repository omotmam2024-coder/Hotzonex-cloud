import { resolve } from 'node:path';
import { ConfigError, loadConfig, parseRetiredKeys } from './config.js';
import { Keyring } from './crypto/keyring.js';
import { SealingKeys } from './crypto/sealing-keys.js';
import { createLogger } from './logger.js';
import { RouterAccess } from './routers/access.js';
import { MockStateFile } from './routers/mock-state.js';
import { startHealthServer } from './server.js';
import { ConnectorService } from './service.js';
import { ConnectorStore } from './store/store.js';
import { SupabaseTransport } from './store/supabase-transport.js';
import { SimulatedWgManager, WgCliManager } from './wireguard/manager.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const log = createLogger(config.LOG_LEVEL);
  const keyring = Keyring.fromBase64(
    { version: config.ENCRYPTION_KEY_VERSION, key: config.ENCRYPTION_KEY },
    parseRetiredKeys(config.ENCRYPTION_KEYS_RETIRED),
  );
  const sealing = await SealingKeys.fromKeyring(keyring);

  const mockState = new MockStateFile(resolve(config.MOCK_STATE_FILE));
  const access = new RouterAccess({
    kind: config.MIKROTIK_PROVIDER,
    keyring,
    mockBehavior: (routerId, host) => mockState.behavior(routerId, host),
  });

  const wg = config.MIKROTIK_PROVIDER === 'mock' ? new SimulatedWgManager() : new WgCliManager(config.WG_INTERFACE);
  const store = new ConnectorStore(new SupabaseTransport(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, config.CONNECTOR_ID));

  const service = new ConnectorService({
    connectorId: config.CONNECTOR_ID,
    providerKind: config.MIKROTIK_PROVIDER,
    store,
    access,
    keyring,
    sealing,
    wg,
    log,
    jobPollSeconds: config.JOB_POLL_INTERVAL_SECONDS,
    jobConcurrency: config.JOB_CONCURRENCY,
    healthPollSeconds: config.HEALTH_POLL_INTERVAL_SECONDS,
    wgServerPublicKey: config.WG_SERVER_PUBLIC_KEY ?? null,
    wgEndpoint: config.WG_ENDPOINT ?? null,
  });

  const server = await startHealthServer(config.HEALTHZ_HOST, config.HEALTHZ_PORT, () => service.health());
  service.start();

  log.info(
    {
      connectorId: config.CONNECTOR_ID,
      provider: config.MIKROTIK_PROVIDER,
      wireguard: wg.kind,
      keyVersions: keyring.versions(),
      healthz: `${config.HEALTHZ_HOST}:${config.HEALTHZ_PORT}`,
    },
    config.MIKROTIK_PROVIDER === 'mock'
      ? 'connector started in MOCK mode: routers and WireGuard are simulated'
      : 'connector started',
  );

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down; finishing in-flight jobs');
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    await service.stop();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(`connector failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
