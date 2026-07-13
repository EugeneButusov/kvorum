// Typed client for the dashboard auth surface (SPEC §6.14). These endpoints are session-cookie
// authenticated and are deliberately kept out of the public read-API OpenAPI contract (M6-2.4), so
// they are typed here by hand rather than generated. Every call goes through the same-origin BFF
// (`/api/*`, ADR-084) so the HttpOnly session cookie is set on the dashboard origin and the browser
// never talks to the API directly.

const CSRF_COOKIE = 'kv_csrf';
const CSRF_HEADER = 'x-csrf-token';

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

/** Thrown for non-2xx auth responses so callers can branch on the HTTP status. */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// The double-submit CSRF cookie is non-HttpOnly by design so the browser can echo it back in the
// header on mutating requests; the backend requires header === cookie === session token.
function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const csrf = readCsrfToken();
  if (csrf) headers[CSRF_HEADER] = csrf;

  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) throw new AuthError(res.status, await problem(res));
  return (await res.json()) as T;
}

async function problem(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string; message?: string };
    return data.detail ?? data.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function fetchNonce(): Promise<string> {
  const { nonce } = await post<{ nonce: string }>('/v1/auth/siwe/nonce');
  return nonce;
}

export function verifySiwe(payload: SiweVerifyPayload): Promise<Session & { address: string }> {
  return post<Session & { address: string }>('/v1/auth/siwe/verify', payload);
}

/** Reads the current session; resolves to null when unauthenticated (401) rather than throwing. */
export async function fetchSession(): Promise<Session | null> {
  const res = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthError(res.status, await problem(res));
  return (await res.json()) as Session;
}

export function logout(): Promise<{ ok: true }> {
  return post<{ ok: true }>('/v1/auth/logout');
}

export function logoutEverywhere(): Promise<{ ok: true }> {
  return post<{ ok: true }>('/v1/auth/logout-all');
}
