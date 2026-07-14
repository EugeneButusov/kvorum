import { NextResponse, type NextRequest } from 'next/server';

// The session cookie is minted and managed by the API — @nest/auth's SessionStore (Redis) plus the
// auth controller's setSessionCookies. It reaches the dashboard origin only by being relayed through
// the same-origin BFF (ADR-084), since the browser never talks to the API directly. This proxy just
// reads its presence; it neither issues nor validates sessions.
const SESSION_COOKIE = 'kv_session';

// How long clients should wait during planned maintenance (§6.15).
const MAINTENANCE_RETRY_SECONDS = 3600;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Operator maintenance gate (§6.15): when MAINTENANCE_MODE is set, every route serves the
  // maintenance page with a real 503 + Retry-After. The page route itself is exempt so the rewrite
  // target can render.
  if (process.env.MAINTENANCE_MODE === '1' && pathname !== '/maintenance') {
    const res = NextResponse.rewrite(new URL('/maintenance', request.url), { status: 503 });
    res.headers.set('Retry-After', String(MAINTENANCE_RETRY_SECONDS));
    return res;
  }

  // Optimistic protected-route gate for /developer (§6.13/§6.14). Cookie *presence* only — validity
  // is confirmed client-side (useRequireSession), so a present-but-expired session still renders and
  // then redirects. This catches "not signed in at all" before any HTML is sent.
  if (pathname === '/developer' || pathname.startsWith('/developer/')) {
    if (!request.cookies.has(SESSION_COOKIE)) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname + search);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on every page route (so maintenance mode can gate the whole site) except Next internals, the
  // BFF API, static files, and the k8s /healthz probe. The /developer auth check runs within.
  // /healthz is exempt on purpose: it must stay 200 during maintenance so pods remain Ready and keep
  // serving the maintenance page (a failing probe would pull them from the Service instead).
  matcher: ['/((?!_next/static|_next/image|api/|healthz|favicon\\.ico|.*\\.[^/]+$).*)'],
};
