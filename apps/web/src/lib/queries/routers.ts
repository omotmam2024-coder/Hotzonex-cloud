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
import type { RouterInput } from '@hotzonex/shared/schemas';
import { toAppError, unwrap } from '../errors';
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
