import { notFound } from 'next/navigation';

import { DaoHeader } from '@/components/dao/dao-header';
import { GovernanceTracks } from '@/components/dao/governance-tracks';
import { HealthSnapshot } from '@/components/dao/health-snapshot';
import { TopDelegates } from '@/components/dao/top-delegates';
import { ProposalCard } from '@/components/home/proposal-card';
import { ProposalRow } from '@/components/proposal/proposal-row';
import {
  fetchConcentration,
  fetchPassRate,
  fetchTopDelegates,
  rangeFrom,
} from '@/lib/analytics/health';
import { serverApi } from '@/lib/api/client';
import {
  fetchProposalPage,
  type ProposalFilters,
  type ProposalListItemView,
} from '@/lib/proposals/list';

type DaoInfo = {
  name: string;
  description: string;
  tokenAddress: string;
  websiteUrl?: string;
  forumUrl?: string;
  sourceTypes: string[];
};

async function loadDao(slug: string): Promise<DaoInfo> {
  const fallback: DaoInfo = {
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    description: '',
    tokenAddress: '',
    sourceTypes: [],
  };
  let result;
  try {
    result = await serverApi().GET('/v1/daos/{slug}', { params: { path: { slug } } });
  } catch {
    // Backend unreachable — degrade rather than 404 a DAO that may well exist (§6.15 keeps reads
    // resilient). notFound() must stay OUT of this catch or it would be swallowed.
    return fallback;
  }
  const { data, error, response } = result;
  // A reachable API saying the DAO isn't tracked is the real 404 → the context-aware "DAO not
  // tracked" page. Other errors degrade to the fallback.
  if (response.status === 404) notFound();
  if (error || !data) return fallback;
  const dao = data.data;
  return {
    name: dao.name,
    description: dao.description,
    tokenAddress: dao.primary_token_address,
    websiteUrl: dao.website_url || undefined,
    forumUrl: dao.forum_url || undefined,
    sourceTypes: dao.sources.map((s) => s.source_type),
  };
}

const BASE_FILTERS: ProposalFilters = {
  dao: [],
  state: [],
};

async function loadProposals(
  slug: string,
  filters: ProposalFilters,
  sort: Parameters<typeof fetchProposalPage>[1]['sort'],
): Promise<ProposalListItemView[]> {
  const page = await fetchProposalPage(serverApi(), { slug, filters, sort }).catch(() => null);
  return page?.items ?? [];
}

export default async function DaoOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const from1y = rangeFrom('1y', Date.now());

  const [dao, active, recent, concentration, passRate, delegates] = await Promise.all([
    loadDao(slug),
    loadProposals(
      slug,
      { ...BASE_FILTERS, state: ['active'] },
      { field: 'voting_ends_at', dir: 'asc' },
    ),
    loadProposals(slug, BASE_FILTERS, { field: 'state_updated_at', dir: 'desc' }),
    fetchConcentration(serverApi(), slug, { from: from1y }),
    fetchPassRate(serverApi(), slug, from1y),
    fetchTopDelegates(serverApi(), slug, 5),
  ]);

  return (
    <div className="flex flex-col gap-12">
      <DaoHeader
        name={dao.name}
        description={dao.description}
        tokenAddress={dao.tokenAddress}
        websiteUrl={dao.websiteUrl}
        forumUrl={dao.forumUrl}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Active proposals</h2>
        {active.length === 0 ? (
          <p className="font-mono text-mono-body text-ink-3">No proposals are currently active.</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {active.map((item) => (
              <ProposalCard key={`${item.sourceType}:${item.sourceId}`} item={item} />
            ))}
          </div>
        )}
      </section>

      <GovernanceTracks sourceTypes={dao.sourceTypes} />

      <div className="grid gap-10 lg:grid-cols-2">
        <HealthSnapshot
          slug={slug}
          gini={concentration.current?.gini ?? null}
          top10Pct={concentration.current?.top10Pct ?? null}
          passRatePct={passRate.overallPct}
        />
        <TopDelegates slug={slug} delegates={delegates} />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Recent activity</h2>
        {recent.length === 0 ? (
          <p className="font-mono text-mono-body text-ink-3">No recent governance activity.</p>
        ) : (
          <ul>
            {recent.map((item) => (
              <li key={`${item.sourceType}:${item.sourceId}`}>
                <ProposalRow item={item} showDao={false} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
