import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobRow } from '@hotzonex/shared/database';
import { ACTIVE_JOB_STATUSES, type JobStatus, type JobType } from '@hotzonex/shared/jobs';
import { sealCredentials, type SealedEnvelope, type SealingPublicKey } from '@hotzonex/shared/sealing';
import { newIdempotencyKey } from '../utils';
import { AppError, unwrap } from '../errors';
import { useRealtimeInvalidate } from '../realtime';
import { getSupabase } from '../supabase';
import { qk } from './keys';

export function isActive(status: string | undefined): boolean {
  return status !== undefined && (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

/** One job, live: Realtime pushes changes; polling covers a dropped socket while it is still running. */
export function useJob(jobId: string | null | undefined) {
  useRealtimeInvalidate('jobs', [qk.job(jobId ?? '')], { filter: `id=eq.${jobId}`, enabled: Boolean(jobId) });
  return useQuery({
    queryKey: qk.job(jobId ?? ''),
    enabled: Boolean(jobId),
    queryFn: async () => unwrap(await getSupabase().from('jobs').select('*').eq('id', jobId as string).maybeSingle()) as JobRow,
    refetchInterval: (q) => (isActive(q.state.data?.status) ? 3_000 : false),
  });
}

export function useRouterJobs(routerId: string) {
  useRealtimeInvalidate('jobs', [qk.routerJobs(routerId)], { filter: `router_id=eq.${routerId}` });
  return useQuery({
    queryKey: qk.routerJobs(routerId),
    queryFn: async () =>
      unwrap(
        await getSupabase().from('jobs').select('*').eq('router_id', routerId).order('created_at', { ascending: false }).limit(25),
      ) as JobRow[],
    refetchInterval: (q) => (q.state.data?.some((j) => isActive(j.status)) ? 5_000 : false),
  });
}

/** Queue an action for the connector. The UI never waits on the router itself. */
export function useEnqueueJob(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, payload }: { type: Exclude<JobType, 'router.ingest_credentials'>; payload?: Record<string, number> }) =>
      unwrap(
        await getSupabase().rpc('enqueue_router_job', {
          p_router_id: routerId,
          p_type: type,
          p_idempotency_key: newIdempotencyKey(),
          p_payload: payload ?? {},
        }),
      ) as JobRow,
    onSuccess: (job) => {
      qc.setQueryData(qk.job(job.id), job);
      void qc.invalidateQueries({ queryKey: qk.routerJobs(routerId) });
    },
  });
}

/**
 * Seal router credentials in the browser to the connector's public key and
 * submit only the envelope. The plaintext never leaves this function's scope
 * and is never stored anywhere in the browser.
 */
export function useSubmitCredentials(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sealingKey, username, password }: { sealingKey: SealingPublicKey | null; username: string; password: string }) => {
      if (!sealingKey) {
        throw new AppError('The Hotzonex connector has not published its encryption key yet, so credentials cannot be sent securely. Check that the connector is running.', 'unknown');
      }
      let envelope: SealedEnvelope;
      try {
        envelope = await sealCredentials(sealingKey, routerId, { username, password });
      } catch {
        throw new AppError('This browser cannot encrypt the credentials. Use a current version of Chrome, Firefox, Edge or Safari over HTTPS.', 'unknown');
      }
      return unwrap(
        await getSupabase().rpc('submit_router_credentials', {
          p_router_id: routerId,
          p_sealed: envelope as never,
          p_idempotency_key: newIdempotencyKey(),
        }),
      ) as JobRow;
    },
    onSuccess: (job) => {
      qc.setQueryData(qk.job(job.id), job);
      void qc.invalidateQueries({ queryKey: qk.router(routerId) });
      void qc.invalidateQueries({ queryKey: qk.routerJobs(routerId) });
    },
  });
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Queued',
  claimed: 'Picked up',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  dead: 'Gave up',
};
