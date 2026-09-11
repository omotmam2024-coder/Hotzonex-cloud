import type { Database, Json } from '@hotzonex/shared/database.types';

type Fns = Database['public']['Functions'];
type Returns<F extends keyof Fns> = Fns[F]['Returns'];
type Row<F extends keyof Fns> = Returns<F> extends Array<infer R> ? R : Returns<F>;

export type JobRow = Row<'connector_claim_jobs'>;
export type ConnectorRouter = Row<'connector_get_router'>;
export type DueRouter = Row<'connector_routers_due'>;
export type Submission = Row<'connector_take_submission'>;
export type RouterStatusValue = Database['public']['Enums']['router_status'];

export interface SyncCounts {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}
export interface SyncSummary {
  interfaces: SyncCounts;
  hotspot_servers: SyncCounts;
  hotspot_profiles: SyncCounts;
  drift_recorded: number;
}

export type FinishOutcome = 'succeeded' | 'retry' | 'defer' | 'failed' | 'dead';

export class StoreError extends Error {
  override readonly name = 'StoreError';
}

/**
 * How the connector reaches the data plane: named function + named args.
 * Production: supabase.rpc() over HTTPS with the service-role key.
 * Tests: the same SQL functions on PGlite.
 */
export interface RpcTransport {
  /** Set-returning / table-returning functions. */
  rows(fn: keyof Fns, args: Record<string, unknown>): Promise<unknown[]>;
  /** Scalar-returning functions (including void). */
  scalar(fn: keyof Fns, args: Record<string, unknown>): Promise<unknown>;
}

export interface HeartbeatInfo {
  version: string;
  provider_mode: 'mock' | 'api' | 'rest';
  sealing_key_id: string;
  sealing_public_key: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  wg_server_public_key: string | null;
  wg_endpoint: string | null;
  wg_server_address: string;
  started_at: string;
}

export class ConnectorStore {
  constructor(private readonly t: RpcTransport) {}

  async heartbeat(connectorId: string, info: HeartbeatInfo): Promise<void> {
    await this.t.scalar('connector_heartbeat', { p_connector_id: connectorId, p_info: info });
  }

  async claimJobs(connectorId: string, limit: number, leaseSeconds: number): Promise<JobRow[]> {
    return (await this.t.rows('connector_claim_jobs', {
      p_connector_id: connectorId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    })) as JobRow[];
  }

  async startJob(jobId: string, connectorId: string): Promise<JobRow | null> {
    const rows = (await this.t.rows('connector_start_job', { p_job_id: jobId, p_connector_id: connectorId })) as JobRow[];
    return rows[0] ?? null;
  }

  async finishJob(args: {
    jobId: string;
    connectorId: string;
    outcome: FinishOutcome;
    result?: Json | null;
    errorCode?: string | null;
    error?: string | null;
    runAfter?: Date | null;
    refundAttempt?: boolean;
  }): Promise<JobRow | null> {
    const rows = (await this.t.rows('connector_finish_job', {
      p_job_id: args.jobId,
      p_connector_id: args.connectorId,
      p_outcome: args.outcome,
      p_result: args.result ?? null,
      p_error_code: args.errorCode ?? null,
      p_error: args.error ?? null,
      p_run_after: args.runAfter ? args.runAfter.toISOString() : null,
      p_refund_attempt: args.refundAttempt ?? false,
    })) as JobRow[];
    return rows[0] ?? null;
  }

  async releaseRouterJobs(routerId: string): Promise<number> {
    return Number(await this.t.scalar('connector_release_router_jobs', { p_router_id: routerId }));
  }

  async getRouter(routerId: string): Promise<ConnectorRouter | null> {
    const rows = (await this.t.rows('connector_get_router', { p_router_id: routerId })) as ConnectorRouter[];
    return rows[0] ?? null;
  }

  async routersDue(defaultIntervalSeconds: number, limit: number): Promise<DueRouter[]> {
    return (await this.t.rows('connector_routers_due', {
      p_default_interval_seconds: defaultIntervalSeconds,
      p_limit: limit,
    })) as DueRouter[];
  }

  async recordPoll(args: {
    routerId: string;
    reachable: boolean;
    status: RouterStatusValue;
    metrics?: Record<string, unknown>;
    errorCode?: string | null;
    errorDetail?: string | null;
  }): Promise<{ previous_status: RouterStatusValue; new_status: RouterStatusValue } | null> {
    const rows = (await this.t.rows('connector_record_poll', {
      p_router_id: args.routerId,
      p_reachable: args.reachable,
      p_status: args.status,
      p_metrics: args.metrics ?? {},
      p_error_code: args.errorCode ?? null,
      p_error_detail: args.errorDetail ?? null,
    })) as Array<{ previous_status: RouterStatusValue; new_status: RouterStatusValue }>;
    return rows[0] ?? null;
  }

  async applySync(routerId: string, snapshot: Record<string, unknown>): Promise<SyncSummary> {
    const result = await this.t.scalar('connector_apply_sync', { p_router_id: routerId, p_snapshot: snapshot });
    if (!result || typeof result !== 'object') throw new StoreError('connector_apply_sync returned no summary');
    return result as SyncSummary;
  }

  async takeSubmission(submissionId: string): Promise<Submission | null> {
    const rows = (await this.t.rows('connector_take_submission', { p_submission_id: submissionId })) as Submission[];
    return rows[0] ?? null;
  }

  async storeCredentials(submissionId: string, username: string, ciphertext: string, keyVersion: number): Promise<void> {
    await this.t.scalar('connector_store_credentials', {
      p_submission_id: submissionId,
      p_username: username,
      p_ciphertext: ciphertext,
      p_key_version: keyVersion,
    });
  }

  async rejectSubmission(submissionId: string, reason: string): Promise<void> {
    await this.t.scalar('connector_reject_submission', { p_submission_id: submissionId, p_reason: reason });
  }

  async credentialsForRekey(currentVersion: number, limit: number): Promise<Row<'connector_credentials_for_rekey'>[]> {
    return (await this.t.rows('connector_credentials_for_rekey', {
      p_current_version: currentVersion,
      p_limit: limit,
    })) as Row<'connector_credentials_for_rekey'>[];
  }

  async updateCiphertext(routerId: string, ciphertext: string, keyVersion: number, expectedVersion: number): Promise<boolean> {
    return Boolean(
      await this.t.scalar('connector_update_ciphertext', {
        p_router_id: routerId,
        p_ciphertext: ciphertext,
        p_key_version: keyVersion,
        p_expected_version: expectedVersion,
      }),
    );
  }

  async wgPeers(): Promise<Row<'connector_wg_peers'>[]> {
    return (await this.t.rows('connector_wg_peers', {})) as Row<'connector_wg_peers'>[];
  }

  async recordHandshakes(handshakes: Array<{ public_key: string; at: string | null }>): Promise<number> {
    return Number(await this.t.scalar('connector_record_handshakes', { p_handshakes: handshakes }));
  }

  async pruneMetrics(defaultRetentionDays: number): Promise<number> {
    return Number(await this.t.scalar('connector_prune_metrics', { p_default_retention_days: defaultRetentionDays }));
  }
}
