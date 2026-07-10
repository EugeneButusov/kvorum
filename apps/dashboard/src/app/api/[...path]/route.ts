// Same-origin backend-for-frontend (ADR-084). Proxies GET reads to the API and passes the
// conditional-GET + rate-limit contract straight through. The read API is currently open
// (key enforcement + tiers arrive with the auth backend); this handler is the seam where a
// server-side key gets injected then — the browser still never holds one.

// Upstream → downstream headers worth forwarding (the ETag / cache / rate-limit contract).
const PASS_THROUGH = [
  'etag',
  'cache-control',
  'content-type',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'retry-after',
];

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const apiUrl = process.env.BACKEND_API_URL ?? 'http://localhost:3001';

  const { path } = await ctx.params;
  const target = new URL(`${apiUrl}/${path.map(encodeURIComponent).join('/')}`);
  target.search = new URL(req.url).search;

  const headers = new Headers();
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch);

  const upstream = await fetch(target, { headers, cache: 'no-store' });

  const res = new Response(upstream.status === 304 ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
  });
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) res.headers.set(name, value);
  }
  return res;
}
