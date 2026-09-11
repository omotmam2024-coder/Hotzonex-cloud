import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hotzonex/shared/database.types';
import { StoreError, type RpcTransport } from './store.js';

const REQUEST_TIMEOUT_MS = 15_000;

/** supabase.rpc() with the service-role key. Server-side only; the key never leaves this process. */
export class SupabaseTransport implements RpcTransport {
  private readonly client: SupabaseClient<Database>;

  constructor(url: string, serviceRoleKey: string, connectorId: string) {
    this.client = createClient<Database>(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { 'x-client-info': `hotzonex-connector/${connectorId}` },
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
      },
    });
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    // The generated client types each function precisely; the store layer owns the per-function typing.
    const rpc = this.client.rpc.bind(this.client) as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string; code?: string; hint?: string } | null }>;
    let response: { data: unknown; error: { message: string; code?: string; hint?: string } | null };
    try {
      response = await rpc(fn, args);
    } catch (error) {
      throw new StoreError(`${fn}: data plane unreachable (${(error as Error).name})`, { cause: error });
    }
    if (response.error) {
      throw new StoreError(`${fn}: ${response.error.message}${response.error.code ? ` [${response.error.code}]` : ''}`);
    }
    return response.data;
  }

  async rows(fn: keyof Database['public']['Functions'], args: Record<string, unknown>): Promise<unknown[]> {
    const data = await this.call(fn, args);
    if (data === null || data === undefined) return [];
    return Array.isArray(data) ? data : [data];
  }

  async scalar(fn: keyof Database['public']['Functions'], args: Record<string, unknown>): Promise<unknown> {
    return this.call(fn, args);
  }
}
