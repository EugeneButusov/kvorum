// Base polling cadences (SPEC §6.16): tally 10s while active, homepage active-proposals
// + activity feed 30s. ADR-035 backs these off as remaining quota drops (see tallyIntervalMs).
export const POLL_INTERVAL_MS = {
  tally: 10_000,
  feed: 30_000,
} as const;

export type PollKind = keyof typeof POLL_INTERVAL_MS;

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
 * Tally poll interval per the ADR-035 quota tiers: ≥25% → 10s, 10–25% → 20s, <10% → paused
 * (`false`). A null fraction (no quota headers) holds the base 10s and never pauses.
 */
export function tallyIntervalMs(fraction: number | null): number | false {
  if (fraction == null) return POLL_INTERVAL_MS.tally;
  if (fraction < 0.1) return false;
  if (fraction < 0.25) return 20_000;
  return POLL_INTERVAL_MS.tally;
}
