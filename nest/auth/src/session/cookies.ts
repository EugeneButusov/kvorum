import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type SessionConfig,
} from './session.config';

// Structural subset of express Response's cookie API — avoids importing express into nest/auth while
// still typing the calls controllers make via @Res().
export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
  maxAge?: number;
  domain?: string;
}

export interface CookieWriter {
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options?: CookieOptions): void;
}

function baseOptions(config: SessionConfig): CookieOptions {
  return {
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    ...(config.cookieDomain !== undefined ? { domain: config.cookieDomain } : {}),
  };
}

export function setSessionCookies(
  res: CookieWriter,
  input: { sessionId: string; csrfToken: string },
  config: SessionConfig,
): void {
  const maxAge = SESSION_TTL_SECONDS * 1000;
  // Session id: HttpOnly (JS must never read it). CSRF token: readable by JS so the client can echo
  // it back in the X-CSRF-Token header (double-submit).
  res.cookie(SESSION_COOKIE, input.sessionId, { ...baseOptions(config), httpOnly: true, maxAge });
  res.cookie(CSRF_COOKIE, input.csrfToken, { ...baseOptions(config), httpOnly: false, maxAge });
}

export function clearSessionCookies(res: CookieWriter, config: SessionConfig): void {
  const opts = baseOptions(config);
  res.clearCookie(SESSION_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, opts);
}
