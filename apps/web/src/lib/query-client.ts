import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient, type Query } from '@tanstack/react-query';
import { AppError, toAppError } from './errors';

export const CACHE_STORAGE_KEY = 'hzx-cache-v1';

/**
 * Offline-tolerant reads: these query families are persisted to localStorage so
 * the dashboard, routers and locations still render (read-only, clearly marked)
 * when a site's link drops. Nothing credential-related is ever fetched by the
 * browser, so nothing credential-related can be persisted. The cache is wiped
 * on sign-out and whenever a different user signs in.
 */
export const PERSISTED_QUERY_ROOTS = ['routers', 'router', 'locations', 'uptime', 'dashboard', 'connector'] as const;

export function shouldPersist(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const root = query.queryKey[0];
  return query.state.status === 'success' && typeof root === 'string' && (PERSISTED_QUERY_ROOTS as readonly string[]).includes(root);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 24 * 60 * 60_000,
        networkMode: 'offlineFirst',
        refetchOnWindowFocus: true,
        retry: (count, error) => toAppError(error).kind === 'network' && count < 2,
      },
      mutations: {
        networkMode: 'online',
        retry: false,
      },
    },
  });
}

export function createPersister() {
  return createSyncStoragePersister({
    storage: typeof window === 'undefined' ? undefined : safeStorage(),
    key: CACHE_STORAGE_KEY,
    throttleTime: 2_000,
  });
}

/** localStorage can throw (private mode, blocked storage); degrade to no persistence. */
function safeStorage(): Storage | undefined {
  try {
    const probe = '__hzx_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function clearPersistedCache(): void {
  try {
    window.localStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    // storage unavailable: nothing persisted
  }
}

export { AppError };
