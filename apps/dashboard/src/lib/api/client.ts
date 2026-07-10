import createClient, { type Middleware } from 'openapi-fetch';

import { readQuotaFromHeaders, setQuota } from './quota';
import type { paths } from './schema';

// Record the rate-limit quota from every response (browser only — the store drives
// client-side adaptive polling; server reads don't render it).
const quotaMiddleware: Middleware = {
  onResponse({ response }) {
    if (typeof window !== 'undefined') {
      const quota = readQuotaFromHeaders(response.headers);
      if (quota) setQuota(quota);
    }
    return response;
  },
};

export type ApiClientOptions = { baseUrl: string; apiKey?: string };

export function createApiClient({ baseUrl, apiKey }: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  client.use(quotaMiddleware);
  return client;
}

/** Browser client → same-origin BFF; the browser never holds a key (ADR-084). */
export const browserApi = createApiClient({ baseUrl: '/api/kv' });

/** Server client → direct to the API with the server-side key (SSR / RSC). */
export function serverApi() {
  return createApiClient({
    baseUrl: process.env.KVORUM_API_URL ?? 'http://localhost:3001',
    apiKey: process.env.KVORUM_API_KEY,
  });
}
