// Same-origin backend-for-frontend (ADR-084). Proxies GET reads to the API, injecting the
// server-side key so the browser never holds one, and passing the conditional-GET +
// rate-limit contract straight through.

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
  const apiUrl = process.env.KVORUM_API_URL ?? 'http://localhost:3001';
  const apiKey = process.env.KVORUM_API_KEY;

  const { path } = await ctx.params;
  const target = new URL(`${apiUrl}/${path.map(encodeURIComponent).join('/')}`);
  target.search = new URL(req.url).search;

  const headers = new Headers();
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
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
