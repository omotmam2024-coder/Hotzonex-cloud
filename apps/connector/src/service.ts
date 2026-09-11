import type { ProviderKind } from '@hotzonex/mikrotik';
import type { Keyring } from './crypto/keyring.js';
import type { SealingKeys } from './crypto/sealing-keys.js';
import { HealthPoller } from './health/poller.js';
import { JobRunner } from './jobs/runner.js';
import type { Logger } from './logger.js';
import { Loop } from './loop.js';
import type { RouterAccess } from './routers/access.js';
import type { ConnectorStore, HeartbeatInfo } from './store/store.js';
import type { WgManager } from './wireguard/manager.js';
import { WgReconciler } from './wireguard/reconciler.js';

export const CONNECTOR_VERSION = '0.1.0';
export const WG_SERVER_ADDRESS = '10.77.0.1';

export interface ServiceDeps {
  connectorId: string;
  providerKind: ProviderKind;
  store: ConnectorStore;
  access: RouterAccess;
  keyring: Keyring;
  sealing: SealingKeys;
  wg: WgManager;
  log: Logger;
  jobPollSeconds: number;
  jobConcurrency: number;
  healthPollSeconds: number;
  wgServerPublicKey: string | null;
  wgEndpoint: string | null;
}

/** Wires the loops together. Each loop is independent: a WireGuard hiccup never stops job processing. */
export class ConnectorService {
  readonly startedAt = Date.now();
  readonly jobs: JobRunner;
  readonly poller: HealthPoller;
  readonly reconciler: WgReconciler;
  private readonly loops: Loop[];

  constructor(private readonly d: ServiceDeps) {
    this.jobs = new JobRunner({
      connectorId: d.connectorId,
      concurrency: d.jobConcurrency,
      leaseSeconds: 300,
      store: d.store,
      access: d.access,
      keyring: d.keyring,
      sealing: d.sealing,
      log: d.log.child({ component: 'jobs' }),
    });
    const pollTick = Math.max(5, Math.min(15, Math.floor(d.healthPollSeconds / 4)));
    this.poller = new HealthPoller({
      store: d.store,
      access: d.access,
      log: d.log.child({ component: 'health' }),
      defaultIntervalSeconds: d.healthPollSeconds,
      tickSeconds: pollTick,
      concurrency: Math.max(2, d.jobConcurrency),
    });
    this.reconciler = new WgReconciler(d.store, d.wg, d.log.child({ component: 'wireguard' }));

    const heartbeat: HeartbeatInfo = {
      version: CONNECTOR_VERSION,
      provider_mode: d.providerKind,
      sealing_key_id: d.sealing.current.kid,
      sealing_public_key: d.sealing.current.publicKey.jwk,
      wg_server_public_key: d.wgServerPublicKey,
      wg_endpoint: d.wgEndpoint,
      wg_server_address: WG_SERVER_ADDRESS,
      started_at: new Date(this.startedAt).toISOString(),
    };

    this.loops = [
      new Loop('heartbeat', 30_000, () => d.store.heartbeat(d.connectorId, heartbeat), d.log),
      new Loop('jobs', d.jobPollSeconds * 1000, () => this.jobs.tick(), d.log),
      new Loop('health', pollTick * 1000, () => this.poller.tick(), d.log),
      new Loop('wireguard', Math.max(d.jobPollSeconds, 15) * 1000, () => this.reconciler.reconcile(), d.log),
      new Loop('retention', 60 * 60_000, () => d.store.pruneMetrics(30), d.log),
    ];
  }

  start(): void {
    this.loops.forEach((loop, i) => loop.start(i * 500));
  }

  health(): { ok: boolean; body: Record<string, unknown> } {
    const now = Date.now();
    const loops = Object.fromEntries(
      this.loops.map((l) => [
        l.name,
        {
          lastSuccessAt: l.lastSuccessAt ? new Date(l.lastSuccessAt).toISOString() : null,
          stalled: l.isStalled(now, this.startedAt),
          lastError: l.lastError,
        },
      ]),
    );
    const critical = this.loops.filter((l) => ['heartbeat', 'jobs', 'health'].includes(l.name));
    const ok = critical.every((l) => !l.isStalled(now, this.startedAt));
    return {
      ok,
      body: {
        status: ok ? 'ok' : 'degraded',
        connectorId: this.d.connectorId,
        version: CONNECTOR_VERSION,
        provider: this.d.providerKind,
        wireguard: this.d.wg.kind,
        uptimeSeconds: Math.round((now - this.startedAt) / 1000),
        jobsInFlight: this.jobs.busy,
        loops,
      },
    };
  }

  async stop(): Promise<void> {
    for (const loop of this.loops) loop.stop();
    await this.jobs.drain();
    await this.d.access.closeAll();
  }
}
