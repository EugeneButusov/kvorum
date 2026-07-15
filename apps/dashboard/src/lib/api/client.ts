import createClient from 'openapi-fetch';

import type { paths } from './schema';

export type ApiClientOptions = { baseUrl: string; apiKey?: string; internalReadToken?: string };

export function createApiClient({ baseUrl, apiKey, internalReadToken }: ApiClientOptions) {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (internalReadToken) headers['x-internal-read-token'] = internalReadToken;
  return createClient<paths>({
    baseUrl,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

/** Browser client → same-origin BFF at `/api/*`; the browser never talks to the API directly (ADR-084). */
export const browserApi = createApiClient({ baseUrl: '/api' });

/**
 * Server client → direct to the API for SSR / RSC (bypasses the BFF, so it must attach the read
 * secret itself — otherwise the API's ApiKeyGuard 401s and the initial server render is empty while
 * only client-side fetches through the BFF succeed). INTERNAL_READ_TOKEN is server-only; the browser
 * never holds it.
 */
export function serverApi() {
  return createApiClient({
    baseUrl: process.env.BACKEND_API_URL ?? 'http://localhost:3001',
    internalReadToken: process.env.INTERNAL_READ_TOKEN,
  });
}
