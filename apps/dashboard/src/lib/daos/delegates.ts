// Data layer for the DAO delegates leaderboard (§6.10 index). One batched call to the delegates
// endpoint — the API ranks delegates by current received voting power and returns each one's share
// and delegator count, so the page never fans out per-delegate requests.

import type { createApiClient } from '@/lib/api/client';

type Api = ReturnType<typeof createApiClient>;

const POWER_DECIMALS = 18n;

/** UInt256 base units → a JS number of whole tokens (loses sub-unit precision, fine for display). */
function scalePower(reported: string): number {
  try {
    const base = BigInt(reported);
    const whole = base / 10n ** POWER_DECIMALS;
    const frac = Number(base % 10n ** POWER_DECIMALS) / Number(10n ** POWER_DECIMALS);
    return Number(whole) + frac;
  } catch {
    return 0;
  }
}

export type DelegateLeaderboardEntry = {
  rank: number;
  address: string;
  displayName: string | null;
  votingPower: number;
  /** Share of the DAO-wide delegated power, as a percentage. */
  sharePct: number;
  delegatorCount: number;
  href: string;
};

export async function loadDelegateLeaderboard(
  api: Api,
  slug: string,
  limit = 50,
): Promise<DelegateLeaderboardEntry[]> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/analytics/delegates', {
      params: { path: { slug }, query: { limit: String(limit) } },
    });
    if (error || !data) return [];
    return data.data.map((r) => ({
      rank: r.rank,
      address: r.address,
      displayName: typeof r.display_name === 'string' ? r.display_name : null,
      votingPower: scalePower(r.voting_power),
      sharePct: Math.round(r.voting_power_share * 1000) / 10,
      delegatorCount: r.delegator_count,
      href: `/daos/${slug}/delegates/${r.address}`,
    }));
  } catch {
    return [];
  }
}
