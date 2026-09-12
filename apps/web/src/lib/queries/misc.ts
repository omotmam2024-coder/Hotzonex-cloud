import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppRole,
  AuditLogRow,
  ConnectorStatusRow,
  InviteRow,
  LocationRow,
  ProfileRow,
  RouterRow,
  SystemSettingRow,
} from '@hotzonex/shared/database';
import type { LocationInput } from '@hotzonex/shared/schemas';
import type { SealingPublicKey } from '@hotzonex/shared/sealing';
import type { SettingKey } from '@hotzonex/shared/settings';
import { toAppError, unwrap } from '../errors';
import { useRealtimeInvalidate } from '../realtime';
import { getSupabase } from '../supabase';
import { qk } from './keys';

// -----------------------------------------------------------------------------
// Locations
// -----------------------------------------------------------------------------
export type LocationWithRouters = LocationRow & { routers: Array<Pick<RouterRow, 'id' | 'name' | 'status' | 'is_demo'>> };

export function useLocations() {
  return useQuery({
    queryKey: qk.locations(),
    queryFn: async () =>
      unwrap(await getSupabase().from('locations').select('*, routers(id, name, status, is_demo)').order('name')) as LocationWithRouters[],
  });
}

export function useSaveLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, tenantId, input }: { id?: string; tenantId: string; input: LocationInput }) => {
      const db = getSupabase();
      if (id) {
        const { data, error } = await db.from('locations').update(input).eq('id', id).select('id');
        if (error) throw toAppError(error);
        if (!data?.length) throw toAppError({ code: '42501' });
        return id;
      }
      return (unwrap(await db.from('locations').insert({ ...input, tenant_id: tenantId }).select('id').single()) as { id: string }).id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.locations() }),
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await getSupabase().from('locations').delete().eq('id', id).select('id');
      if (error) throw toAppError(error);
      if (!data?.length) throw toAppError({ code: '42501' });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.locations() });
      await qc.invalidateQueries({ queryKey: qk.routers() });
    },
  });
}

export function useAssignRouterLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ routerId, locationId }: { routerId: string; locationId: string | null }) => {
      const { error } = await getSupabase().from('routers').update({ location_id: locationId }).eq('id', routerId);
      if (error) throw toAppError(error);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.locations() });
      await qc.invalidateQueries({ queryKey: qk.routers() });
    },
  });
}

// -----------------------------------------------------------------------------
// Connector status
// -----------------------------------------------------------------------------
export interface ConnectorView {
  row: ConnectorStatusRow | null;
  online: boolean;
  mock: boolean;
  sealingKey: SealingPublicKey | null;
  wg: { serverPublicKey: string; endpointHost: string; endpointPort: number; serverAddress: string } | null;
}

export const HEARTBEAT_FRESH_MS = 90_000;

export function describeConnector(row: ConnectorStatusRow | null, now = Date.now()): ConnectorView {
  if (!row) return { row: null, online: false, mock: false, sealingKey: null, wg: null };
  const online = now - Date.parse(row.last_heartbeat_at) < HEARTBEAT_FRESH_MS;
  const jwk = row.sealing_public_key as { kty?: string; crv?: string; x?: string; y?: string } | null;
  const sealingKey =
    jwk?.kty === 'EC' && jwk.crv === 'P-256' && jwk.x && jwk.y
      ? { kid: row.sealing_key_id, jwk: { kty: 'EC' as const, crv: 'P-256' as const, x: jwk.x, y: jwk.y } }
      : null;
  const endpoint = /^(.+):(\d{1,5})$/.exec(row.wg_endpoint ?? '');
  const wg =
    row.wg_server_public_key && endpoint && row.wg_server_address
      ? { serverPublicKey: row.wg_server_public_key, endpointHost: endpoint[1] as string, endpointPort: Number(endpoint[2]), serverAddress: row.wg_server_address }
      : null;
  return { row, online, mock: row.provider_mode === 'mock', sealingKey, wg };
}

export function useConnector() {
  useRealtimeInvalidate('connector_status', [qk.connector()]);
  return useQuery({
    queryKey: qk.connector(),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('connector_status')
        .select('*')
        .order('last_heartbeat_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw toAppError(error);
      return (data ?? null) as ConnectorStatusRow | null;
    },
    select: (row) => describeConnector(row),
  });
}

// -----------------------------------------------------------------------------
// Audit log (immutable; keyset pagination)
// -----------------------------------------------------------------------------
export interface AuditFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  actor?: string;
  from?: string;
  to?: string;
}

const AUDIT_PAGE = 50;

export function useAuditLog(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: qk.audit(filters),
    initialPageParam: null as { created_at: string; id: number } | null,
    queryFn: async ({ pageParam }) => {
      let q = getSupabase().from('audit_logs').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(AUDIT_PAGE);
      if (filters.action) q = q.ilike('action', `${filters.action.replace(/[%_]/g, '')}%`);
      if (filters.entityType) q = q.eq('entity_type', filters.entityType);
      if (filters.entityId) q = q.eq('entity_id', filters.entityId);
      if (filters.actor) q = q.ilike('actor_email', `%${filters.actor.replace(/[%_]/g, '')}%`);
      if (filters.from) q = q.gte('created_at', new Date(filters.from).toISOString());
      if (filters.to) q = q.lte('created_at', new Date(`${filters.to}T23:59:59.999`).toISOString());
      if (pageParam) q = q.or(`created_at.lt.${pageParam.created_at},and(created_at.eq.${pageParam.created_at},id.lt.${pageParam.id})`);
      return unwrap(await q) as AuditLogRow[];
    },
    getNextPageParam: (last) => {
      if (last.length < AUDIT_PAGE) return null;
      const tail = last[last.length - 1] as AuditLogRow;
      return { created_at: tail.created_at, id: tail.id };
    },
  });
}

// -----------------------------------------------------------------------------
// Settings, organization, team
// -----------------------------------------------------------------------------
export function useSettings() {
  return useQuery({
    queryKey: qk.settings(),
    queryFn: async () => unwrap(await getSupabase().from('system_settings').select('*')) as SystemSettingRow[],
  });
}

export function useSaveSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenantId, key, value, existing }: { tenantId: string; key: SettingKey; value: number; existing: boolean }) => {
      const db = getSupabase();
      const res = existing
        ? await db.from('system_settings').update({ value }).eq('tenant_id', tenantId).eq('key', key).select('id')
        : await db.from('system_settings').insert({ tenant_id: tenantId, key, value }).select('id');
      if (res.error) throw toAppError(res.error);
      if (!res.data?.length) throw toAppError({ code: '42501' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings() }),
  });
}

export function useSaveOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenantId, name, currency }: { tenantId: string; name: string; currency: 'SSP' | 'USD' }) => {
      const { data, error } = await getSupabase().from('tenants').update({ name, currency_default: currency }).eq('id', tenantId).select('id');
      if (error) throw toAppError(error);
      if (!data?.length) throw toAppError({ code: '42501' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function useTeam() {
  return useQuery({
    queryKey: qk.team(),
    queryFn: async () => unwrap(await getSupabase().from('profiles').select('*').order('email')) as ProfileRow[],
  });
}

export function useInvites(enabled: boolean) {
  return useQuery({
    queryKey: qk.invites(),
    enabled,
    queryFn: async () =>
      unwrap(
        await getSupabase().from('invites').select('*').is('accepted_at', null).is('revoked_at', null).order('created_at', { ascending: false }),
      ) as InviteRow[],
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: 'ADMIN' | 'TECHNICIAN' }) => {
      const rows = unwrap(await getSupabase().rpc('create_invite', { p_email: email, p_role: role })) as Array<{ invite_id: string; token: string }>;
      const row = rows[0];
      if (!row) throw toAppError({ code: 'P0002' });
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites() }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await getSupabase().rpc('revoke_invite', { p_invite_id: inviteId });
      if (error) throw toAppError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites() }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, role, status }: { profileId: string; role: AppRole; status: 'active' | 'suspended' }) => {
      unwrap(await getSupabase().rpc('update_member', { p_profile_id: profileId, p_role: role, p_status: status }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.team() }),
  });
}

export interface PendingAccount {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
}

/** Accounts created in Supabase without an invite, waiting for a SUPER_ADMIN to grant access. */
export function usePendingAccounts(enabled: boolean) {
  return useQuery({
    queryKey: qk.pendingAccounts(),
    enabled,
    queryFn: async () => unwrap(await getSupabase().rpc('list_pending_accounts')) as PendingAccount[],
  });
}

export function useGrantAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'TECHNICIAN' }) => {
      unwrap(await getSupabase().rpc('grant_access', { p_user_id: userId, p_role: role }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.pendingAccounts() });
      void qc.invalidateQueries({ queryKey: qk.team() });
    },
  });
}

export function useRemovePendingAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await getSupabase().rpc('remove_pending_account', { p_user_id: userId });
      if (error) throw toAppError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.pendingAccounts() }),
  });
}

export function useUpdateProfileName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, fullName }: { id: string; fullName: string }) => {
      const { error } = await getSupabase().from('profiles').update({ full_name: fullName }).eq('id', id);
      if (error) throw toAppError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}
