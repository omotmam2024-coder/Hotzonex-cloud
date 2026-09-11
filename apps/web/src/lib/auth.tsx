import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { capabilitiesFor, type Capabilities, type Role } from '@hotzonex/shared/roles';
import type { ProfileRow, TenantRow } from '@hotzonex/shared/database';
import { clearPersistedCache } from './query-client';
import { toAppError, type AppError } from './errors';
import { getSupabase } from './supabase';

export interface AuthState {
  status: 'loading' | 'signed_out' | 'signed_in';
  session: Session | null;
  profile: ProfileRow | null;
  tenant: TenantRow | null;
  role: Role | null;
  can: Capabilities;
  profileError: AppError | null;
  profileLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const LAST_USER_KEY = 'hzx-last-user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  // Never show one user's cached data to another user on a shared device.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    try {
      const last = window.localStorage.getItem(LAST_USER_KEY);
      if (last && last !== userId) {
        queryClient.clear();
        clearPersistedCache();
      }
      window.localStorage.setItem(LAST_USER_KEY, userId);
    } catch {
      // storage unavailable
    }
  }, [userId, queryClient]);

  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, tenant:tenants(*)')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw toAppError(error);
      return data as (ProfileRow & { tenant: TenantRow | null }) | null;
    },
  });

  const signOut = useCallback(async () => {
    await supabase.auth.signOut().catch(() => undefined);
    queryClient.clear();
    clearPersistedCache();
  }, [supabase, queryClient]);

  const value = useMemo<AuthState>(() => {
    const row = profileQuery.data ?? null;
    const active = row && row.status === 'active' ? row : null;
    const role = (active?.role ?? null) as Role | null;
    const { tenant, ...profile } = row ?? { tenant: null };
    return {
      status: !ready ? 'loading' : session ? 'signed_in' : 'signed_out',
      session,
      profile: row ? (profile as ProfileRow) : null,
      tenant: tenant ?? null,
      role,
      can: capabilitiesFor(role),
      profileError: profileQuery.error ? toAppError(profileQuery.error) : null,
      profileLoading: profileQuery.isPending && Boolean(userId),
      signOut,
    };
  }, [ready, session, profileQuery.data, profileQuery.error, profileQuery.isPending, userId, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
