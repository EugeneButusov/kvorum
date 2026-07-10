import createClient from 'openapi-fetch';

import type { paths } from './schema';

export type ApiClientOptions = { baseUrl: string; apiKey?: string };

export function createApiClient({ baseUrl, apiKey }: ApiClientOptions) {
  return createClient<paths>({
    baseUrl,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
}

/** Browser client → same-origin BFF; the browser never talks to the API directly (ADR-084). */
export const browserApi = createApiClient({ baseUrl: '/api/kv' });

/**
 * Server client → direct to the API for SSR / RSC. Reads are currently open; when the auth
 * backend lands, the server-side / session key is attached here (via createApiClient's
 * `apiKey`) — the browser still never holds one.
 */
export function serverApi() {
  return createApiClient({ baseUrl: process.env.BACKEND_API_URL ?? 'http://localhost:3001' });
}
