import { NextResponse, type NextRequest } from 'next/server';

// The session cookie is minted and managed by the API — @nest/auth's SessionStore (Redis) plus the
// auth controller's setSessionCookies. It reaches the dashboard origin only by being relayed through
// the same-origin BFF (ADR-084), since the browser never talks to the API directly. This proxy just
// reads its presence; it neither issues nor validates sessions.
const SESSION_COOKIE = 'kv_session';

// Optimistic protected-route gate (§6.13/§6.14). This proxy (formerly the "middleware" convention)
// can only see the cookie's *presence*, not its validity — a present-but-expired session still
// renders, then the client-side session guard redirects once the 401 comes back. This catches the
// common "not signed in at all" case before any HTML is sent, so there's no protected-content flash.
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/developer', '/developer/:path*'],
};
