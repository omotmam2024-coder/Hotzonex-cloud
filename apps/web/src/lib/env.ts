import { z } from 'zod';

/**
 * Browser configuration. Only the public Supabase URL and the anon key —
 * every privileged key (database admin key, encryption key) lives only in the connector.
 */
const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
});

export type WebEnv = { supabaseUrl: string; supabaseAnonKey: string };

export function readEnv(source: Record<string, unknown> = import.meta.env): { ok: true; env: WebEnv } | { ok: false; missing: string[] } {
  const parsed = schema.safeParse(source);
  if (!parsed.success) return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
  return { ok: true, env: { supabaseUrl: parsed.data.VITE_SUPABASE_URL, supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY } };
}
