// Shared client for the session-cookie-authenticated surface (auth + developer dashboard). These
// endpoints are kept out of the public OpenAPI contract, so they're called by hand here. Everything
// goes through the same-origin BFF (`/api/*`, ADR-084): the HttpOnly session cookie rides along and
// the browser never talks to the API directly.

const CSRF_COOKIE = 'kv_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** Thrown for non-2xx responses so callers can branch on the HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The double-submit CSRF cookie is non-HttpOnly by design so the browser can echo it back in the
// header on mutating requests; the backend requires header === cookie === session token.
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function problemDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string; message?: string };
    return data.detail ?? data.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/** GET a session-authed endpoint. Throws ApiError on non-2xx (callers handle 401 as they see fit). */
export async function sessionGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, await problemDetail(res));
  return (await res.json()) as T;
}

/** POST/DELETE/PUT/PATCH a session-authed endpoint, attaching the double-submit CSRF header. */
export async function sessionMutate<T>(
  method: 'POST' | 'DELETE' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const csrf = readCsrfToken();
  if (csrf) headers[CSRF_HEADER] = csrf;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw new ApiError(res.status, await problemDetail(res));
  return (await res.json()) as T;
}
