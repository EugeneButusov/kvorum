// Data layer for the DAOs directory (§6.6): the tracked-DAO list plus the couple of health metrics
// we can actually compute today (pass rate, top-10 VP concentration) from the analytics endpoints.
// TVL / treasury / a composite grade / activity sparkline / mismatch flags need external data, a
// scoring model, or M5 — they're deferred, not faked (see the directory-enhancements issue).

import { fetchConcentration, fetchPassRate, rangeFrom } from '@/lib/analytics/health';
import type { createApiClient } from '@/lib/api/client';
import { sourceLabel } from '@/lib/proposals/source';

type Api = ReturnType<typeof createApiClient>;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export type DaoDirectoryEntry = {
  slug: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  forumUrl: string | null;
  /** Human governor/source labels, e.g. ["Governor Bravo", "Snapshot"]. */
  governors: string[];
  /** 90-day pass rate (%), or null when the analytics have no resolved proposals. */
  passRatePct: number | null;
  /** Current top-10 voting-power share (%), or null when concentration has no history. */
  top10Pct: number | null;
  /** Change in top-10 share over ~90 days (percentage points), or null. */
  top10Delta: number | null;
};

async function fetchGovernors(api: Api, slug: string): Promise<string[]> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/sources', {
      params: { path: { slug } },
    });
    if (error || !data) return [];
    return data.data.map((s) => sourceLabel(s.source_type));
  } catch {
    return [];
  }
}

/**
 * The tracked-DAO directory with per-DAO health metrics. One list call plus a few analytics calls per
 * DAO, all parallel and each degrading to null on failure so a single slow endpoint never 500s the
 * page. This fans out with the DAO count — fine at today's handful; a directory-summary endpoint
 * would replace the fan-out if coverage grows.
 */
export async function loadDaoDirectory(api: Api, now: number): Promise<DaoDirectoryEntry[]> {
  let daos: {
    slug: string;
    name: string;
    description: string;
    website_url: string;
    forum_url: string;
  }[];
  try {
    const { data, error } = await api.GET('/v1/daos', { params: { query: { limit: 100 } } });
    if (error || !data) return [];
    daos = data.data;
  } catch {
    return [];
  }

  const from = rangeFrom('90d', now);

  return Promise.all(
    daos.map(async (dao): Promise<DaoDirectoryEntry> => {
      const [governors, passRate, concentration] = await Promise.all([
        fetchGovernors(api, dao.slug),
        fetchPassRate(api, dao.slug, from),
        fetchConcentration(api, dao.slug, { from, bucket: 'monthly' }),
      ]);
      return {
        slug: dao.slug,
        name: dao.name,
        description: asString(dao.description),
        websiteUrl: asString(dao.website_url),
        forumUrl: asString(dao.forum_url),
        governors,
        passRatePct: passRate.overallPct,
        top10Pct: concentration.current?.top10Pct ?? null,
        top10Delta: concentration.delta90Top10,
      };
    }),
  );
}
