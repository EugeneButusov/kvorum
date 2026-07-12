// Rate-limit quota tracking and ADR-035 adaptive-polling backoff. Separate from poll.ts (which only
// holds the base cadences): this is about the RateLimit-* budget and how polling adapts to it.

// Remaining rate-limit quota as a fraction of the tier's ceiling, from the RateLimit-* headers.
// `fraction` is null when the API doesn't emit them (keyless dashboard reads until the per-IP
// limiter lands in M6-6) — the caller then holds the base cadence and never pauses.
export type QuotaState = { fraction: number | null };

export function parseQuota(headers: Headers): QuotaState {
  const remaining = Number(headers.get('ratelimit-remaining'));
  const limit = Number(headers.get('ratelimit-limit'));
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) {
    return { fraction: null };
  }
  return { fraction: Math.max(0, Math.min(1, remaining / limit)) };
}

/**
 * Adaptive poll interval for a given base cadence, per the ADR-035 quota tiers: ≥25% → base,
 * 10–25% → 2× base, <10% → paused (`false`). A null fraction (no quota headers) holds the base
 * cadence and never pauses. Generic over the base so tally (10s) and the feed (30s) share it.
 */
export function quotaInterval(baseMs: number, fraction: number | null): number | false {
  if (fraction == null) return baseMs;
  if (fraction < 0.1) return false;
  if (fraction < 0.25) return baseMs * 2;
  return baseMs;
}
