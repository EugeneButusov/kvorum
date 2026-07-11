import type Redis from 'ioredis';

// Per-key usage counters, kept in Redis (the rate-limit sliding-window counters only hold the
// current minute/day window, so they can't serve §6.13's 30-day-by-family chart or month totals).
// Keys, all under usage:<keyId>:
//   :fam:<family>:<yyyymmdd>  daily per-family counter (35-day TTL → covers the 30-day window)
//   :month:<yyyymm>           current-month total (for the key-list view + quota bar)
//   :families                 set of families seen (so the breakdown needs no KEYS scan)

const DAY_TTL_SECONDS = 35 * 24 * 60 * 60;
const FAMILIES_TTL_SECONDS = DAY_TTL_SECONDS;

const pad = (n: number): string => String(n).padStart(2, '0');
const dayKey = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const monthKey = (d: Date): string => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;

const famDayKey = (keyId: string, family: string, d: Date): string =>
  `usage:${keyId}:fam:${family}:${dayKey(d)}`;
const monthTotalKey = (keyId: string, d: Date): string => `usage:${keyId}:month:${monthKey(d)}`;
const familiesKey = (keyId: string): string => `usage:${keyId}:families`;

export class UsageStore {
  constructor(private readonly redis: Redis) {}

  async record(keyId: string, family: string, at: Date = new Date()): Promise<void> {
    await this.redis
      .multi()
      .incr(famDayKey(keyId, family, at))
      .expire(famDayKey(keyId, family, at), DAY_TTL_SECONDS)
      .incr(monthTotalKey(keyId, at))
      // Two months of retention so a month boundary doesn't lose the prior total immediately.
      .expire(monthTotalKey(keyId, at), 62 * 24 * 60 * 60)
      .sadd(familiesKey(keyId), family)
      .expire(familiesKey(keyId), FAMILIES_TTL_SECONDS)
      .exec();
  }

  async currentMonthTotal(keyId: string, at: Date = new Date()): Promise<number> {
    const raw = await this.redis.get(monthTotalKey(keyId, at));
    return raw === null ? 0 : Number(raw);
  }

  // Request volume over the trailing 30 days, grouped by endpoint family.
  async last30DaysByFamily(keyId: string, at: Date = new Date()): Promise<Record<string, number>> {
    const families = await this.redis.smembers(familiesKey(keyId));
    if (families.length === 0) {
      return {};
    }
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(at);
      d.setUTCDate(d.getUTCDate() - i);
      return d;
    });

    const out: Record<string, number> = {};
    for (const family of families) {
      const values = await this.redis.mget(days.map((d) => famDayKey(keyId, family, d)));
      const total = values.reduce((sum, v) => sum + (v === null ? 0 : Number(v)), 0);
      // Omit families with no requests inside the window (their `families` entry lingers via TTL).
      if (total > 0) {
        out[family] = total;
      }
    }
    return out;
  }
}

// First path segment after /v1/ (daos, proposals, votes, actors, delegations, …); 'other' otherwise.
export function endpointFamily(routePath: string): string {
  const match = /(?:^|\/)v1\/([^/?]+)/.exec(routePath);
  return match?.[1] ?? 'other';
}
