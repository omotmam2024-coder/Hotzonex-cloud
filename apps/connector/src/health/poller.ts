import { CircuitOpenError, isMikrotikError } from '@hotzonex/mikrotik';
import { assessHealth, statusAfterFailure, type RouterStatus } from '@hotzonex/shared/status';
import type { Logger } from '../logger.js';
import { NoCredentialsError, type RouterAccess } from '../routers/access.js';
import type { ConnectorStore, DueRouter } from '../store/store.js';

export interface HealthPollerOptions {
  store: ConnectorStore;
  access: RouterAccess;
  log: Logger;
  /** Default interval; tenants may override with the health_poll_interval_seconds setting. */
  defaultIntervalSeconds: number;
  /** How often the poller wakes up to look for due routers. */
  tickSeconds: number;
  concurrency: number;
  now?: () => number;
}

/**
 * Polls router health on a conservative schedule (default every 5 minutes).
 *   - Staggered: at most (due × tick / interval) + 1 routers per tick, so a
 *     backlog (e.g. after a connector restart) spreads across a whole
 *     interval instead of bursting every site link at once.
 *   - Routers whose circuit breaker is open are NOT contacted; the missed
 *     poll is still recorded, so uptime history and OFFLINE status stay honest.
 *   - last_seen_at only moves on success: a powered-off router keeps its last
 *     contact time while flipping to OFFLINE after N missed polls.
 */
export class HealthPoller {
  private readonly now: () => number;

  constructor(private readonly o: HealthPollerOptions) {
    this.now = o.now ?? Date.now;
  }

  /** Poll one batch of due routers. Returns how many were polled. */
  async tick(): Promise<number> {
    const due = await this.o.store.routersDue(this.o.defaultIntervalSeconds, 500);
    if (due.length === 0) return 0;
    const neverPolled = due.filter((r) => r.last_polled_at === null);
    const backlog = due.filter((r) => r.last_polled_at !== null);
    const interval = Math.min(...backlog.map((r) => r.poll_interval_seconds), this.o.defaultIntervalSeconds);
    const budget = Math.ceil((backlog.length * this.o.tickSeconds) / Math.max(interval, this.o.tickSeconds)) + 1;
    // New routers first (onboarding feedback), then the most overdue.
    const batch = [...neverPolled, ...backlog.slice(0, budget)];

    let index = 0;
    const workers = Array.from({ length: Math.min(this.o.concurrency, batch.length) }, async () => {
      while (index < batch.length) {
        const router = batch[index++] as DueRouter;
        await this.poll(router).catch((error: unknown) => {
          this.o.log.error({ routerId: router.id, err: { name: (error as Error).name, message: (error as Error).message } }, 'recording a health poll failed');
        });
      }
    });
    await Promise.all(workers);
    return batch.length;
  }

  async poll(router: DueRouter): Promise<void> {
    const log = this.o.log.child({ routerId: router.id });
    const previous = router.status as RouterStatus;

    if (this.o.access.isCircuitOpen(router)) {
      const next = statusAfterFailure(previous, router.consecutive_failures, router.offline_after_missed_polls);
      await this.o.store.recordPoll({
        routerId: router.id,
        reachable: false,
        status: next,
        errorCode: this.o.access.breaker(router).lastErrorCode ?? 'UNREACHABLE',
        errorDetail: 'not contacted: circuit breaker open after repeated failures',
      });
      return;
    }

    const started = this.now();
    try {
      const { resource, health } = await this.o.access.run(router, async (p) => {
        const resource = await p.getSystemResource();
        // Sensors are optional (CHR/x86 have none, some builds refuse the menu); never fail a poll over them.
        const health = await p.getSystemHealth().catch((error: unknown) => {
          if (isMikrotikError(error) && error.stage === 'command') return { sensors: [] };
          throw error;
        });
        return { resource, health };
      });
      const verdict = assessHealth({
        cpuLoad: resource.cpuLoad,
        freeMemory: resource.freeMemory,
        totalMemory: resource.totalMemory,
        sensors: health.sensors,
      });
      const version = /^([0-9][^\s(]*)/.exec(resource.version)?.[1] ?? null;
      const result = await this.o.store.recordPoll({
        routerId: router.id,
        reachable: true,
        status: verdict.status,
        metrics: {
          latency_ms: this.now() - started,
          cpu_load: resource.cpuLoad,
          free_memory: resource.freeMemory,
          total_memory: resource.totalMemory,
          uptime_seconds: resource.uptimeSeconds,
          health: { sensors: health.sensors },
          routeros_version: version,
          board_name: resource.boardName,
          architecture: resource.architecture,
          status_reason: verdict.reason,
        },
      });
      if (result && (result.previous_status === 'offline' || result.previous_status === 'unknown')) {
        const released = await this.o.store.releaseRouterJobs(router.id);
        log.info({ from: result.previous_status, released }, 'router is reachable again');
      }
    } catch (error) {
      if (error instanceof NoCredentialsError) return;
      const code = isMikrotikError(error) ? error.code : error instanceof CircuitOpenError ? 'UNREACHABLE' : 'UNKNOWN';
      const detail = isMikrotikError(error) ? error.detail : null;
      const next = statusAfterFailure(previous, router.consecutive_failures, router.offline_after_missed_polls);
      await this.o.store.recordPoll({ routerId: router.id, reachable: false, status: next, errorCode: code, errorDetail: detail });
      if (next === 'offline' && previous !== 'offline') log.warn({ code }, 'router is now OFFLINE');
    }
  }
}
