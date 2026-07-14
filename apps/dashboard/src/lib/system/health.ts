// Degraded-mode signal (§6.15). The dashboard polls the API's public /health (through the BFF) and,
// when it reports a degraded state, surfaces a non-blocking banner — reads still work, the user is
// just told the data may be stale. The current /health is liveness-only, so this returns null today
// and lights up automatically once /health carries a `degraded` payload (backend follow-up).

export type DegradedStatus = { reason: string; retryAfterSeconds?: number };

type HealthPayload = {
  status?: string;
  degraded?: { reason?: string; retryAfterSeconds?: number };
};

export async function fetchDegradedStatus(): Promise<DegradedStatus | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });

    // A hard 503 from the health check itself is degraded (read-only / maintenance window).
    if (res.status === 503) {
      const retry = Number(res.headers.get('retry-after'));
      return {
        reason: 'Kvorum is in a degraded state. Data may be stale.',
        retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
      };
    }
    if (!res.ok) return null;

    const body = (await res.json()) as HealthPayload;
    if (body.status && body.status !== 'ok' && body.degraded?.reason) {
      return { reason: body.degraded.reason, retryAfterSeconds: body.degraded.retryAfterSeconds };
    }
    return null;
  } catch {
    // Health unreachable — don't cry wolf with a degraded banner; individual reads report their own
    // failures.
    return null;
  }
}
