// Kubernetes liveness/readiness probe target. Returns 200 as long as the Next server
// process is up — deliberately independent of the backend API (the BFF `/api/*` proxy
// is the wrong thing to probe) and of MAINTENANCE_MODE (exempted in proxy.ts so pods
// stay Ready and keep serving the maintenance page). Never cached.
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
  });
}
