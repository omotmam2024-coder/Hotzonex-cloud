import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HotspotProfileRow,
  HotspotServerRow,
  LocationRow,
  RouterInterfaceRow,
  RouterMetricRow,
  RouterRow,
  SyncDriftRow,
} from '@hotzonex/shared/database';
import type { JobRow } from '@hotzonex/shared/database';
import type { RouterConnectionInput, RouterInput } from '@hotzonex/shared/schemas';
import { sealCredentials, type SealedEnvelope, type SealingPublicKey } from '@hotzonex/shared/sealing';
import { AppError, toAppError, unwrap } from '../errors';
import { newIdempotencyKey } from '../utils';
import { useRealtimeInvalidate } from '../realtime';
import { getSupabase } from '../supabase';
import { qk } from './keys';

export type RouterWithLocation = RouterRow & { location: Pick<LocationRow, 'id' | 'name'> | null };

export function useRouters() {
  useRealtimeInvalidate('routers', [qk.routers(), ['router'], ['dashboard']]);
  return useQuery({
    queryKey: qk.routers(),
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap(
        await getSupabase()
          .from('routers')
          .select('*, location:locations(id, name)')
          .order('is_demo', { ascending: true })
          .order('name'),
      ) as RouterWithLocation[],
  });
}

export function useRouter(id: string | undefined) {
  useRealtimeInvalidate('routers', [qk.router(id ?? '')], { filter: `id=eq.${id}`, enabled: Boolean(id) });
  return useQuery({
    queryKey: qk.router(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: 30_000,
    queryFn: async () =>
      unwrap(await getSupabase().from('routers').select('*, location:locations(id, name)').eq('id', id as string).maybeSingle()) as RouterWithLocation,
  });
}

export function useRouterInterfaces(id: string) {
  return useQuery({
    queryKey: qk.routerInterfaces(id),
    queryFn: async () =>
      unwrap(await getSupabase().from('router_interfaces').select('*').eq('router_id', id).order('name')) as RouterInterfaceRow[],
  });
}

export function useRouterHotspot(id: string) {
  return useQuery({
    queryKey: qk.routerHotspot(id),
    queryFn: async () => {
      const db = getSupabase();
      const [servers, profiles] = await Promise.all([
        db.from('hotspot_servers').select('*').eq('router_id', id).order('name'),
        db.from('hotspot_profiles').select('*').eq('router_id', id).order('name'),
      ]);
      return { servers: unwrap(servers) as HotspotServerRow[], profiles: unwrap(profiles) as HotspotProfileRow[] };
    },
  });
}

export function useRouterDrift(id: string) {
  useRealtimeInvalidate('sync_drift', [qk.routerDrift(id)], { filter: `router_id=eq.${id}` });
  return useQuery({
    queryKey: qk.routerDrift(id),
    queryFn: async () =>
      unwrap(
        await getSupabase().from('sync_drift').select('*').eq('router_id', id).order('detected_at', { ascending: false }).limit(50),
      ) as SyncDriftRow[],
  });
}

/** Latest reachable health sample (sensors, latency). */
export function useLatestMetric(id: string) {
  return useQuery({
    queryKey: qk.routerMetrics(id),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('router_metrics')
        .select('*')
        .eq('router_id', id)
        .eq('reachable', true)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw toAppError(error);
      return (data ?? null) as RouterMetricRow | null;
    },
  });
}

export interface UptimeBucket {
  router_id: string;
  bucket_start: string;
  samples: number;
  reachable_samples: number;
}

export function useUptime(days = 7) {
  return useQuery({
    queryKey: qk.uptime(days),
    refetchInterval: 5 * 60_000,
    queryFn: async () =>
      unwrap(await getSupabase().rpc('router_uptime_buckets', { p_days: days, p_bucket_hours: 6 })) as UptimeBucket[],
  });
}

export function useCreateRouter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RouterInput & { tenant_id: string }) =>
      unwrap(
        await getSupabase()
          .from('routers')
          .insert({
            tenant_id: input.tenant_id,
            name: input.name,
            location_id: input.location_id,
            api_protocol: input.api_protocol,
            api_port: input.api_port,
            use_ssl: input.use_ssl,
            notes: input.notes,
          })
          .select('id')
          .single(),
      ) as { id: string },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.routers() }),
  });
}

/**
 * Add a router that is on the same network as the connector, in one action:
 * create it at the given address, seal the login the technician typed to the
 * connector's public key, and queue the connection test.
 *
 * The password is sealed in the browser and never stored here; the connector is
 * the only thing that can open the envelope. If sealing or the test queue fails
 * the router row is left in place — it has no credentials, so it is inert, and
 * the wizard offers to try again rather than losing what was typed.
 */
export function useConnectRouter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      input,
      tenantId,
      sealingKey,
    }: {
      input: RouterConnectionInput;
      tenantId: string;
      sealingKey: SealingPublicKey | null;
    }): Promise<{ routerId: string; credentialJob: JobRow; testJob: JobRow }> => {
      if (!sealingKey) {
        throw new AppError(
          'The Hotzonex connector has not published its encryption key yet, so the password cannot be sent securely. Check that the connector is running.',
          'unknown',
        );
      }
      const db = getSupabase();
      const router = unwrap(
        await db
          .from('routers')
          .insert({
            tenant_id: tenantId,
            name: input.name,
            host: input.host,
            api_protocol: input.api_protocol,
            api_port: input.api_port,
            use_ssl: input.use_ssl,
            notes: input.notes,
          })
          .select('id')
          .single(),
      ) as { id: string };

      let envelope: SealedEnvelope;
      try {
        envelope = await sealCredentials(sealingKey, router.id, { username: input.username, password: input.password });
      } catch {
        throw new AppError('This browser cannot encrypt the password. Use a current version of Chrome, Firefox, Edge or Safari over HTTPS.', 'unknown');
      }
      const credentialJob = unwrap(
        await db.rpc('submit_router_credentials', {
          p_router_id: router.id,
          p_sealed: envelope as never,
          p_idempotency_key: newIdempotencyKey(),
        }),
      ) as JobRow;

      const testJob = unwrap(
        await db.rpc('enqueue_router_job', {
          p_router_id: router.id,
          p_type: 'router.test_connection',
          p_idempotency_key: newIdempotencyKey(),
          p_payload: {},
        }),
      ) as JobRow;

      return { routerId: router.id, credentialJob, testJob };
    },
    onSuccess: ({ routerId, credentialJob, testJob }) => {
      qc.setQueryData(qk.job(credentialJob.id), credentialJob);
      qc.setQueryData(qk.job(testJob.id), testJob);
      void qc.invalidateQueries({ queryKey: qk.routers() });
      void qc.invalidateQueries({ queryKey: qk.router(routerId) });
    },
  });
}

/**
 * Give an existing local router a working login again — after a password
 * change on the router, or a rejected envelope. Its address may have moved too,
 * so the connection fields are saved with it.
 */
export function useReconnectRouter(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, sealingKey }: { input: RouterConnectionInput; sealingKey: SealingPublicKey | null }) => {
      if (!sealingKey) {
        throw new AppError(
          'The Hotzonex connector has not published its encryption key yet, so the password cannot be sent securely. Check that the connector is running.',
          'unknown',
        );
      }
      const db = getSupabase();
      const { error } = await db
        .from('routers')
        .update({ host: input.host, api_protocol: input.api_protocol, api_port: input.api_port, use_ssl: input.use_ssl })
        .eq('id', routerId);
      if (error) throw toAppError(error);

      let envelope: SealedEnvelope;
      try {
        envelope = await sealCredentials(sealingKey, routerId, { username: input.username, password: input.password });
      } catch {
        throw new AppError('This browser cannot encrypt the password. Use a current version of Chrome, Firefox, Edge or Safari over HTTPS.', 'unknown');
      }
      unwrap(
        await db.rpc('submit_router_credentials', { p_router_id: routerId, p_sealed: envelope as never, p_idempotency_key: newIdempotencyKey() }),
      );
      return unwrap(
        await db.rpc('enqueue_router_job', {
          p_router_id: routerId,
          p_type: 'router.test_connection',
          p_idempotency_key: newIdempotencyKey(),
          p_payload: {},
        }),
      ) as JobRow;
    },
    onSuccess: (job) => {
      qc.setQueryData(qk.job(job.id), job);
      void qc.invalidateQueries({ queryKey: qk.router(routerId) });
      void qc.invalidateQueries({ queryKey: qk.routers() });
    },
  });
}

export type RouterPatch = Partial<
  Pick<RouterRow, 'name' | 'location_id' | 'api_protocol' | 'api_port' | 'use_ssl' | 'notes' | 'wg_public_key' | 'hotspot_server_id' | 'default_hotspot_profile_id' | 'onboarding_completed_at'>
>;

export function useUpdateRouter(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: RouterPatch) => {
      const { error } = await getSupabase().from('routers').update(patch).eq('id', id);
      if (error) throw toAppError(error);
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.router(id) }), qc.invalidateQueries({ queryKey: qk.routers() })]);
    },
  });
}

export function useDeleteRouter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await getSupabase().from('routers').delete().eq('id', id).select('id');
      if (error) throw toAppError(error);
      // RLS hides rows a role may not delete: zero rows means "not allowed", never silent success.
      if (!data || data.length === 0) throw toAppError({ code: '42501' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.routers() }),
  });
}

export function useResolveDrift(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driftId: string) => {
      unwrap(await getSupabase().rpc('resolve_drift', { p_drift_id: driftId }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.routerDrift(routerId) }),
  });
}
