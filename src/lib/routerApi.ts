import { supabase, type Router } from './supabase';

const BASE = ((import.meta.env.VITE_ROUTER_API_URL as string | undefined) ?? '').replace(/\/$/, '');
export const routerApiConfigured = !!BASE;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!BASE) throw new Error('Router API address is not set (VITE_ROUTER_API_URL)');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the router API. Check the VPS is running and online.');
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export type RouterInput = {
  host: string; port?: number; conn: 'rest' | 'api'; tls: boolean; username: string; password: string;
};

export type SyncResult = { ok: boolean; pushed?: number; removed?: number; expired?: number; active?: number; error?: string };

export const routerApi = {
  health: () => call<{ ok: boolean }>('GET', '/health'),
  add: (b: RouterInput & { tenant_id: string; site_id: string; name: string }) => call<Router>('POST', '/routers', b),
  test: (id: string) => call<{ ok: boolean; version?: string; board?: string; uptime?: string }>('POST', `/routers/${id}/test`),
  updateConnection: (id: string, b: RouterInput) => call<Router>('PUT', `/routers/${id}/connection`, b),
  sync: (id: string) => call<SyncResult>('POST', `/routers/${id}/sync`),
  profiles: (id: string) => call<{ name: string; rateLimit: string | null; sharedUsers: string | null }[]>('GET', `/routers/${id}/profiles`),
  remove: (id: string) => call<void>('DELETE', `/routers/${id}`),
};
