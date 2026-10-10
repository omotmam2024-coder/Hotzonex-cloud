import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configMissing = !url || !key;

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
});

// `routers` has a column-level grant: never select('*') from the browser.
export const ROUTER_COLS =
  'id,tenant_id,site_id,name,host,port,conn,tls,username,routeros_version,board_name,status,last_seen_at,last_error,created_at';

export type Role = 'owner' | 'admin' | 'cashier' | 'agent';
export type VoucherStatus = 'unused' | 'sold' | 'active' | 'expired' | 'disabled';

export type Tenant = { id: string; name: string; currency: string; auto_sale_on_activation: boolean };

export type Site = {
  id: string; tenant_id: string; name: string; timezone: string;
  opens_at: string | null; closes_at: string | null; hotspot_server: string;
};

export type Plan = {
  id: string; tenant_id: string; site_id: string; name: string; price: number; currency: string;
  uptime_seconds: number; validity_seconds: number | null; bytes_limit: number | null;
  hotspot_profile: string; color: string; active: boolean;
};

export type Agent = {
  id: string; tenant_id: string; site_id: string | null; name: string; phone: string | null;
  code: string; commission_pct: number; active: boolean;
};

export type Router = {
  id: string; tenant_id: string; site_id: string; name: string; host: string; port: number;
  conn: 'rest' | 'api'; tls: boolean; username: string; routeros_version: string | null;
  board_name: string | null; status: 'unknown' | 'online' | 'offline' | 'auth_failed';
  last_seen_at: string | null; last_error: string | null; created_at: string;
};

export type Voucher = {
  id: string; site_id: string; plan_id: string; batch_id: string | null; code: string;
  status: VoucherStatus; pushed_at: string | null; push_error: string | null; removed_at: string | null;
  sold_at: string | null; first_login_at: string | null; expires_at: string | null; expired_at: string | null;
  uptime_used_seconds: number; bytes_used: number; created_at: string;
};

export type DeviceKind =
  | 'router' | 'switch' | 'access_point' | 'bridge' | 'olt' | 'onu' | 'starlink'
  | 'media_converter' | 'ups' | 'server' | 'other';

export type Device = {
  id: string; tenant_id: string; site_id: string | null; kind: DeviceKind; name: string;
  vendor: string | null; model: string | null; serial: string | null; mac: string | null; ip: string | null;
  location: string | null; status: 'in_service' | 'spare' | 'faulty' | 'retired';
  installed_on: string | null; purchase_price: number | null; currency: string; notes: string | null;
  created_at: string; updated_at: string;
};

/** Supabase/PostgREST errors carry the SQL `raise exception` text in `.message`. */
export function errText(e: unknown): string {
  if (!e) return 'Something went wrong';
  if (typeof e === 'string') return e;
  const m = (e as { message?: string }).message;
  return m ?? 'Something went wrong';
}
