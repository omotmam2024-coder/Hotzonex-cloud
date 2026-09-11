import type { QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';
import { getSupabase } from './supabase';

/**
 * Subscribe to Supabase Realtime changes on a table (RLS applies to what is
 * delivered) and invalidate the given query keys when anything changes.
 * Replaces a bespoke WebSocket server. Queries keep their own polling
 * fallback, so a dropped Realtime socket only makes updates slower.
 */
export function useRealtimeInvalidate(
  table: 'routers' | 'jobs' | 'sync_drift' | 'connector_status',
  keys: QueryKey[],
  opts: { filter?: string; enabled?: boolean } = {},
): void {
  const queryClient = useQueryClient();
  const id = useId();
  const enabled = opts.enabled ?? true;
  const keyString = JSON.stringify(keys);

  useEffect(() => {
    if (!enabled) return;
    const supabase = getSupabase();
    const parsed = JSON.parse(keyString) as QueryKey[];
    const channel = supabase
      .channel(`rt-${table}-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(opts.filter ? { filter: opts.filter } : {}) }, () => {
        for (const key of parsed) void queryClient.invalidateQueries({ queryKey: key });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, opts.filter, enabled, keyString, queryClient, id]);
}
