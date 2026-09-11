import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hotzonex/shared/database.types';
import { readEnv } from './env';

export type Db = SupabaseClient<Database>;

let client: Db | null = null;

/**
 * The only way the browser talks to the data plane: the anon key plus the
 * user's session, with Row Level Security deciding what they can see and do.
 * The session lives in Secure, SameSite=Strict cookies (not HttpOnly — the
 * browser client and Realtime need the token; see docs/DECISIONS.md).
 */
export function getSupabase(): Db {
  if (client) return client;
  const env = readEnv();
  if (!env.ok) throw new Error(`Missing configuration: ${env.missing.join(', ')}`);
  client = createBrowserClient<Database>(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    cookieOptions: {
      name: 'hzx-auth',
      path: '/',
      sameSite: 'strict',
      secure: window.location.protocol === 'https:',
      maxAge: 60 * 60 * 24 * 7,
    },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  }) as unknown as Db;
  return client;
}
