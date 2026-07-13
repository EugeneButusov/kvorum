// Typed client for the dashboard auth surface (SPEC §6.14). Session-cookie authenticated and kept
// out of the public read-API OpenAPI contract (M6-2.4), so typed here by hand. Built on the shared
// session-fetch helpers, which carry the same-origin BFF + double-submit CSRF contract.

import { ApiError, sessionMutate } from '@/lib/api/session';

/** Retained name for auth-specific error handling; the shared ApiError carries the status + detail. */
export { ApiError as AuthError };

export type Session = {
  userId: string;
  /** Wallet address for SIWE identities; null for (future) email-only accounts. */
  address: string | null;
};

export type SiweVerifyPayload = {
  message: string;
  signature: string;
  /** Optional recovery email captured on the signup path. */
  email?: string;
};

export async function fetchNonce(): Promise<string> {
  const { nonce } = await sessionMutate<{ nonce: string }>('POST', '/v1/auth/siwe/nonce');
  return nonce;
}

export function verifySiwe(payload: SiweVerifyPayload): Promise<Session & { address: string }> {
  return sessionMutate<Session & { address: string }>('POST', '/v1/auth/siwe/verify', payload);
}

/** Reads the current session; resolves to null when unauthenticated (401) rather than throwing. */
export async function fetchSession(): Promise<Session | null> {
  const res = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return (await res.json()) as Session;
}

export function logout(): Promise<{ ok: true }> {
  return sessionMutate<{ ok: true }>('POST', '/v1/auth/logout');
}

export function logoutEverywhere(): Promise<{ ok: true }> {
  return sessionMutate<{ ok: true }>('POST', '/v1/auth/logout-all');
}
