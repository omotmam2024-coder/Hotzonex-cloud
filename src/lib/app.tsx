import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Role, type Site, type Tenant } from './supabase';

type Membership = { tenant_id: string; role: Role; site_id: string | null; tenant: Tenant };

type AppState = {
  session: Session | null;
  loading: boolean;
  memberships: Membership[];
  tenant: Tenant | null;
  role: Role | null;
  isAdmin: boolean;
  isOwner: boolean;
  sites: Site[];
  /** '' means "all sites" (admins only). Cashiers are pinned to their site. */
  siteId: string;
  site: Site | null;
  setTenantId: (id: string) => void;
  setSiteId: (id: string) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantIdState] = useState(read('hz.tenant'));
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteIdState] = useState(read('hz.site'));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  const reload = useCallback(async () => {
    if (!userId) { setMemberships([]); setSites([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('memberships')
      .select('tenant_id, role, site_id, tenant:tenants(id, name, currency, auto_sale_on_activation)')
      .eq('user_id', userId);
    const ms = ((data ?? []) as unknown as Membership[]).filter((m) => m.tenant);
    setMemberships(ms);
    const tid = ms.find((m) => m.tenant_id === tenantId)?.tenant_id ?? ms[0]?.tenant_id ?? '';
    if (tid !== tenantId) { setTenantIdState(tid); write('hz.tenant', tid); }
    if (tid) {
      const { data: s } = await supabase.from('sites').select('*').eq('tenant_id', tid).order('name');
      setSites((s ?? []) as Site[]);
    } else setSites([]);
    setLoading(false);
  }, [userId, tenantId]);

  useEffect(() => { if (authReady) reload(); }, [authReady, reload]);

  const m = memberships.find((x) => x.tenant_id === tenantId) ?? null;
  const role = m?.role ?? null;
  const isAdmin = role === 'owner' || role === 'admin';

  // Pinned staff always work at their site; others pick (or "all" for admins).
  const effectiveSiteId = useMemo(() => {
    if (m?.site_id) return m.site_id;
    if (siteId && sites.some((s) => s.id === siteId)) return siteId;
    return isAdmin ? '' : sites[0]?.id ?? '';
  }, [m, siteId, sites, isAdmin]);

  const value: AppState = {
    session,
    loading: !authReady || loading,
    memberships,
    tenant: m?.tenant ?? null,
    role,
    isAdmin,
    isOwner: role === 'owner',
    sites,
    siteId: effectiveSiteId,
    site: sites.find((s) => s.id === effectiveSiteId) ?? null,
    setTenantId: (id) => { setTenantIdState(id); write('hz.tenant', id); setSiteIdState(''); write('hz.site', ''); },
    setSiteId: (id) => { setSiteIdState(id); write('hz.site', id); },
    reload,
    signOut: async () => { await supabase.auth.signOut(); setMemberships([]); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Small data hook: re-runs when deps change, exposes reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fn()); }
    catch (e) { setError((e as Error).message ?? String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, setData, loading, error, reload: run };
}

/** Throws the Supabase error so useLoad can show it. */
export function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? ([] as unknown)) as T;
}
