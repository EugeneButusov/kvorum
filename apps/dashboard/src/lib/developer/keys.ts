// Data layer for the developer dashboard (§6.13): API-key CRUD against the session-authed /v1/keys
// backend (M6-2.3), which is kept out of the public OpenAPI contract, so it's typed here by hand.

import { sessionGet, sessionMutate } from '@/lib/api/session';

export type KeyStatus = 'active' | 'expiring' | 'revoked';

export type ApiKey = {
  id: string;
  /** The kv_live_ prefix shown to the user (SPEC §4.3 — prefix + last 4, never the secret). */
  prefix: string;
  last_four: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  status: KeyStatus;
};

/** The create/rotate response — the only time the full secret is ever returned. */
export type CreatedKey = ApiKey & { key: string };

export async function fetchKeys(): Promise<ApiKey[]> {
  const { data } = await sessionGet<{ data: ApiKey[] }>('/v1/keys');
  return data;
}

export function createKey(label?: string): Promise<CreatedKey> {
  const trimmed = label?.trim();
  return sessionMutate<CreatedKey>('POST', '/v1/keys', trimmed ? { label: trimmed } : {});
}

export function rotateKey(id: string): Promise<CreatedKey> {
  return sessionMutate<CreatedKey>('POST', `/v1/keys/${id}/rotate`);
}

export function revokeKey(id: string): Promise<{ ok: true }> {
  return sessionMutate<{ ok: true }>('DELETE', `/v1/keys/${id}`);
}

export function deleteAccount(): Promise<void> {
  return sessionMutate<void>('DELETE', '/v1/account');
}
