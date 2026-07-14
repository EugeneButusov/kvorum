import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from './session';
import { SESSION_QUERY_KEY } from '@/lib/auth/session-key';

export function makeQueryClient(): QueryClient {
  const queryCache = new QueryCache();
  const mutationCache = new MutationCache();
  const client = new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 2,
      },
    },
  });

  // Session-expiry handling (§6.13/§6.14): any session-authed request that comes back 401 means the
  // cookie has lapsed, so clear the cached session. Protected pages watch that value and redirect to
  // login — so an expired session resolves cleanly wherever the 401 surfaces, not just on a reload.
  // Attached after construction so the handler can close over the client without a forward reference.
  const clearSessionOn401 = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      client.setQueryData(SESSION_QUERY_KEY, null);
    }
  };
  queryCache.config.onError = clearSessionOn401;
  mutationCache.config.onError = clearSessionOn401;

  return client;
}
