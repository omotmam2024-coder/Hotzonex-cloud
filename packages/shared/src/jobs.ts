import { z } from 'zod';
import { MIKROTIK_ERROR_CODES } from '@hotzonex/mikrotik/errors';

/**
 * Job type registry. Mirrors public.job_types (a DB test asserts they match).
 * Retry policy:
 *   - destructive → never retried automatically; a failure waits for a human.
 *   - deferWhenOffline → waits (without consuming attempts) while the router is offline.
 *   - maxAttempts → execution attempts before the job goes dead.
 */
export interface JobTypePolicy {
  label: string;
  destructive: boolean;
  deferWhenOffline: boolean;
  maxAttempts: number;
  userEnqueueable: boolean;
}

export const JOB_TYPES = {
  'router.test_connection': { label: 'Connection test', destructive: false, deferWhenOffline: false, maxAttempts: 1, userEnqueueable: true },
  'router.test_permissions': { label: 'Permission check', destructive: false, deferWhenOffline: false, maxAttempts: 1, userEnqueueable: true },
  'router.sync': { label: 'Discovery & sync', destructive: false, deferWhenOffline: true, maxAttempts: 5, userEnqueueable: true },
  'router.fetch_logs': { label: 'Fetch logs', destructive: false, deferWhenOffline: false, maxAttempts: 1, userEnqueueable: true },
  'router.ingest_credentials': { label: 'Store credentials', destructive: false, deferWhenOffline: false, maxAttempts: 3, userEnqueueable: false },
  // The one write of Phase 1. Every step is idempotent — it updates the rows it
  // owns rather than adding more — so a retry after a half-applied run converges.
  'router.enable_remote': { label: 'Enable remote access', destructive: false, deferWhenOffline: false, maxAttempts: 3, userEnqueueable: true },
} as const satisfies Record<string, JobTypePolicy>;

export type JobType = keyof typeof JOB_TYPES;
export const JOB_TYPE_NAMES = Object.keys(JOB_TYPES) as JobType[];

export function isJobType(value: unknown): value is JobType {
  return typeof value === 'string' && value in JOB_TYPES;
}

export const JOB_STATUSES = ['pending', 'claimed', 'running', 'succeeded', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['pending', 'claimed', 'running'];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['succeeded', 'failed', 'dead'];

/** Error codes a job can end with: the MikroTik set plus job-level conditions. */
export const JOB_ERROR_CODES = [
  ...MIKROTIK_ERROR_CODES,
  'EXPIRED',
  'NO_CREDENTIALS',
  'CREDENTIALS_UNREADABLE',
  'ROUTER_NOT_FOUND',
  'INTERNAL',
] as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

// -----------------------------------------------------------------------------
// Payloads (validated in the database too)
// -----------------------------------------------------------------------------
export const fetchLogsPayloadSchema = z.object({ limit: z.number().int().min(1).max(500) }).strict();
export const emptyPayloadSchema = z.object({}).strict();
export const ingestCredentialsPayloadSchema = z.object({ submission_id: z.uuid() }).strict();

export const jobPayloadSchemas = {
  'router.test_connection': emptyPayloadSchema,
  'router.test_permissions': emptyPayloadSchema,
  'router.sync': emptyPayloadSchema,
  'router.fetch_logs': fetchLogsPayloadSchema,
  'router.ingest_credentials': ingestCredentialsPayloadSchema,
  'router.enable_remote': emptyPayloadSchema,
} as const satisfies Record<JobType, z.ZodType>;

// -----------------------------------------------------------------------------
// Results (written by the connector, parsed by the UI)
// -----------------------------------------------------------------------------
export const testConnectionResultSchema = z.object({
  latencyMs: z.number().int().nonnegative(),
  identity: z.string(),
  routerOsVersion: z.string(),
  boardName: z.string().nullable(),
  architecture: z.string().nullable(),
  cpuLoad: z.number().int().min(0).max(100),
  freeMemory: z.number().int().nonnegative(),
  totalMemory: z.number().int().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
});
export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

export const permissionCheckSchema = z.object({
  operation: z.string(),
  ok: z.boolean(),
  errorCode: z.string().nullable(),
});

export const testPermissionsResultSchema = z.object({
  username: z.string(),
  group: z.string(),
  policies: z.array(z.string()),
  required: z.array(z.string()),
  missing: z.array(z.string()),
  excess: z.array(z.string()),
  checks: z.array(permissionCheckSchema),
});
export type TestPermissionsResult = z.infer<typeof testPermissionsResultSchema>;

const syncCountsSchema = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  unchanged: z.number().int(),
});

export const syncResultSchema = z.object({
  identity: z.string(),
  routerOsVersion: z.string(),
  boardName: z.string().nullable(),
  architecture: z.string().nullable(),
  interfaces: syncCountsSchema,
  hotspot_servers: syncCountsSchema,
  hotspot_profiles: syncCountsSchema,
  drift_recorded: z.number().int(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;

export const fetchLogsResultSchema = z.object({
  entries: z.array(
    z.object({ id: z.string(), time: z.string(), topics: z.array(z.string()), message: z.string() }),
  ),
});
export type FetchLogsResult = z.infer<typeof fetchLogsResultSchema>;

export const ingestCredentialsResultSchema = z.object({
  stored: z.boolean(),
  superseded: z.boolean(),
  keyVersion: z.number().int().positive().nullable(),
});
export type IngestCredentialsResult = z.infer<typeof ingestCredentialsResultSchema>;

export const enableRemoteResultSchema = z.object({
  /** The router's own WireGuard public key; its private key never leaves it. */
  publicKey: z.string(),
  /** The tunnel address it will answer on from now on. */
  address: z.string(),
  /** The connector that takes over once the router is on the tunnel. */
  connectorId: z.string().nullable(),
});
export type EnableRemoteResult = z.infer<typeof enableRemoteResultSchema>;

export const jobResultSchemas = {
  'router.test_connection': testConnectionResultSchema,
  'router.test_permissions': testPermissionsResultSchema,
  'router.sync': syncResultSchema,
  'router.fetch_logs': fetchLogsResultSchema,
  'router.ingest_credentials': ingestCredentialsResultSchema,
  'router.enable_remote': enableRemoteResultSchema,
} as const satisfies Record<JobType, z.ZodType>;

export type JobResult<T extends JobType> = z.infer<(typeof jobResultSchemas)[T]>;
