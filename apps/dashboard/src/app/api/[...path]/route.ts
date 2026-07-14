// Same-origin backend-for-frontend (ADR-084). Proxies reads (GET) and the dashboard auth surface
// (POST /v1/auth/*) to the API. The browser never talks to the API directly, so session cookies are
// set on the dashboard origin: the Cookie request header is forwarded upstream and any Set-Cookie
// is forwarded back downstream. This handler is also the seam where a server-side key would get
// injected on reads — the browser still never holds one.

// Upstream → downstream response headers worth forwarding (the ETag / cache / rate-limit contract).
const PASS_THROUGH = [
  'etag',
  'cache-control',
  'content-type',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'retry-after',
  'www-authenticate',
];

function apiBaseUrl(): string {
  return process.env.BACKEND_API_URL ?? 'http://localhost:3001';
}

function targetUrl(req: Request, path: string[]): URL {
  const target = new URL(`${apiBaseUrl()}/${path.map(encodeURIComponent).join('/')}`);
  target.search = new URL(req.url).search;
  return target;
}

// Builds the downstream Response, forwarding the pass-through headers plus every Set-Cookie the
// upstream emitted (Headers.getSetCookie preserves multiple cookies, which .get() would collapse).
function relay(upstream: Response, body: BodyInit | null): Response {
  const res = new Response(body, { status: upstream.status, statusText: upstream.statusText });
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) res.headers.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    res.headers.append('set-cookie', cookie);
  }
  return res;
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;

  const headers = new Headers();
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch);
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('Cookie', cookie);

  const upstream = await fetch(targetUrl(req, path), { headers, cache: 'no-store' });
  return relay(upstream, upstream.status === 304 ? null : upstream.body);
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;

  const headers = new Headers();
  for (const name of ['content-type', 'cookie', 'x-csrf-token']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(targetUrl(req, path), {
    method: 'POST',
    headers,
    body: await req.text(),
    cache: 'no-store',
  });
  return relay(upstream, upstream.body);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;

  // Key revoke + account deletion (§6.13) — mutating, so cookie + CSRF are forwarded like POST.
  const headers = new Headers();
  for (const name of ['cookie', 'x-csrf-token']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(targetUrl(req, path), {
    method: 'DELETE',
    headers,
    cache: 'no-store',
  });
  return relay(upstream, upstream.status === 204 ? null : upstream.body);
}
