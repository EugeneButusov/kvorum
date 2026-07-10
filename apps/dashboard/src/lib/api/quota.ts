// Adaptive-polling quota logic (ADR-035). Framework-agnostic + a tiny external store
// updated from RateLimit-* response headers.

export type Quota = { limit: number; remaining: number; resetSeconds: number } | null;
export type PollKind = 'tally' | 'feed';

const BASE_MS: Record<PollKind, number> = { tally: 10_000, feed: 30_000 };

/**
 * Map remaining rate-limit quota to a poll interval in ms, or `false` to pause.
 * ADR-035: ≥25% → base (10s tally / 30s feed); 10–25% → 2× base; <10% → paused.
 * Unknown quota is optimistic (base interval).
 */
export function pollInterval(kind: PollKind, quota: Quota): number | false {
  const base = BASE_MS[kind];
  if (!quota || quota.limit <= 0) return base;
  const ratio = quota.remaining / quota.limit;
  if (ratio < 0.1) return false;
  if (ratio < 0.25) return base * 2;
  return base;
}

export function readQuotaFromHeaders(headers: Headers): Quota {
  const limitRaw = headers.get('RateLimit-Limit');
  const remainingRaw = headers.get('RateLimit-Remaining');
  // Absent headers → no quota info (Number(null) is 0, so guard on the raw value first).
  if (limitRaw === null || remainingRaw === null) return null;
  const limit = Number(limitRaw);
  const remaining = Number(remainingRaw);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;
  const reset = Number(headers.get('RateLimit-Reset'));
  return { limit, remaining, resetSeconds: Number.isFinite(reset) ? reset : 0 };
}

let current: Quota = null;
const listeners = new Set<() => void>();

export function setQuota(quota: Quota): void {
  current = quota;
  for (const listener of listeners) listener();
}

export function getQuota(): Quota {
  return current;
}

export function subscribeQuota(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** A `refetchInterval` function for TanStack Query — re-reads live quota each tick. */
export function adaptiveRefetchInterval(kind: PollKind): () => number | false {
  return () => pollInterval(kind, getQuota());
}
