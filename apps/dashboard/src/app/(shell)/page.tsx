import type { Metadata } from 'next';

import { ActiveProposals } from '@/components/home/active-proposals';
import { ActivityFeed } from '@/components/home/activity-feed';
import { DaoHealthCards } from '@/components/home/dao-health-cards';
import { MismatchFlags } from '@/components/home/mismatch-flags';
import { StatsBar } from '@/components/home/stats-bar';
import { serverApi } from '@/lib/api/client';
import { normalizeListItem, type ProposalListItemView } from '@/lib/proposals/list';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  title: 'Kvorum — Governance intelligence for DeFi DAOs',
};

// Refresh the SSR seed every 30s (ISR), matching the live sections' poll cadence — the page stays
// cacheable but never serves a badly stale first paint, and the client polls on top.
export const revalidate = 30;

async function loadDaos(): Promise<{ slug: string; name: string }[]> {
  try {
    const { data, error } = await serverApi().GET('/v1/daos', {
      params: { query: { limit: 100 } },
    });
    if (error || !data) return [];
    return data.data.map((d) => ({ slug: d.slug, name: d.name }));
  } catch {
    return [];
  }
}

async function loadProposals(query: {
  state?: string;
  sort?: string;
  limit?: number;
}): Promise<ProposalListItemView[]> {
  try {
    const { data, error } = await serverApi().GET('/v1/proposals', { params: { query } });
    if (error || !data) return [];
    return data.data.map(normalizeListItem);
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [daos, active, recent] = await Promise.all([
    loadDaos(),
    loadProposals({ state: 'active', sort: 'voting_ends_at', limit: 12 }),
    loadProposals({ sort: '-state_updated_at', limit: 15 }),
  ]);

  return (
    <div className="flex flex-col gap-12">
      <StatsBar daoCount={daos.length} />
      <ActiveProposals initialItems={active} />
      <MismatchFlags />
      <DaoHealthCards daos={daos} />
      <ActivityFeed initialItems={recent} />
    </div>
  );
}
