import { ConcentrationSection } from '@/components/health/concentration-section';
import { HealthHeader, type HealthKpi } from '@/components/health/health-header';
import { HealthTakeawaysSection } from '@/components/health/health-takeaways-section';
import { RecentProposalsSection } from '@/components/health/recent-proposals-section';
import { TreasurySection } from '@/components/health/treasury-section';
import { TrendsSection } from '@/components/health/trends-section';
import {
  fetchConcentration,
  fetchParticipation,
  fetchPassRate,
  rangeFrom,
  toLorenzBars,
} from '@/lib/analytics/health';
import { serverApi } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { resolveTracks } from '@/lib/dao/tracks';
import { loadDelegateLeaderboard } from '@/lib/daos/delegates';
import { truncateAddress } from '@/lib/format';
import { fetchProposalPage } from '@/lib/proposals/list';

type DaoDetail = components['schemas']['DaoDetailDto'];

type DaoMeta = {
  name: string;
  contractAddress: string;
  governorLabel: string;
  forumUrl: string | null;
  sourceTypes: string[];
};

async function loadDaoMeta(slug: string): Promise<DaoMeta> {
  const fallback = slug.charAt(0).toUpperCase() + slug.slice(1);
  try {
    const { data, error } = await serverApi().GET('/v1/daos/{slug}', {
      params: { path: { slug } },
    });
    if (error || !data) return fallbackMeta(fallback);
    const dao = (data as { data?: DaoDetail }).data;
    if (!dao) return fallbackMeta(fallback);
    const sourceTypes = dao.sources.map((s) => s.source_type);
    const tracks = resolveTracks(sourceTypes);
    return {
      name: dao.name || fallback,
      contractAddress: truncateAddress(dao.primary_token_address || ''),
      governorLabel: tracks[0]?.label ?? '',
      forumUrl: dao.forum_url || null,
      sourceTypes,
    };
  } catch {
    return fallbackMeta(fallback);
  }
}

function fallbackMeta(name: string): DaoMeta {
  return { name, contractAddress: '', governorLabel: '', forumUrl: null, sourceTypes: [] };
}

export default async function DaoHealthPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const from90d = rangeFrom('90d', Date.now());

  const [meta, concentration, passRate, participation, delegates, proposals] = await Promise.all([
    loadDaoMeta(slug),
    fetchConcentration(serverApi(), slug, { from: from90d }),
    fetchPassRate(serverApi(), slug, from90d),
    fetchParticipation(serverApi(), slug, from90d),
    loadDelegateLeaderboard(serverApi(), slug, 50),
    fetchProposalPage(serverApi(), {
      slug,
      filters: { dao: [], state: [] },
      sort: { field: 'voting_ends_at', dir: 'desc' },
    }).catch(() => ({ items: [], nextCursor: null })),
  ]);

  const top10 = delegates.slice(0, 10);
  const lorenzBars = toLorenzBars(delegates.map((d) => d.sharePct));

  const kpis: HealthKpi[] = [
    {
      label: 'Pass rate (90d)',
      value: passRate.overallPct == null ? '—' : `${passRate.overallPct}%`,
    },
    {
      label: 'Participation',
      value: participation.overallPct == null ? '—' : `${participation.overallPct}%`,
    },
    {
      label: 'Top-10 VP',
      value: concentration.current == null ? '—' : `${concentration.current.top10Pct.toFixed(1)}%`,
      deltaPp: concentration.delta90Top10,
      higherIsWorse: true,
    },
    { label: 'Open flags', value: '—' },
  ];

  return (
    <div className="flex flex-col gap-9">
      <HealthHeader
        name={meta.name}
        slug={slug}
        contractAddress={meta.contractAddress}
        governorLabel={meta.governorLabel}
        forumUrl={meta.forumUrl}
        kpis={kpis}
      />

      <HealthTakeawaysSection slug={slug} />
      <TrendsSection passRate={passRate} participation={participation} />
      <ConcentrationSection
        delegates={top10}
        concentration={concentration}
        lorenzBars={lorenzBars}
      />
      <TreasurySection />
      <RecentProposalsSection proposals={proposals.items.slice(0, 6)} />
    </div>
  );
}
