import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { ActionsSection } from '@/components/proposal/actions-section';
import { DescriptionSection } from '@/components/proposal/description-section';
import { ForumSection } from '@/components/proposal/forum-section';
import { MismatchSection } from '@/components/proposal/mismatch-section';
import { ProposalHeader } from '@/components/proposal/proposal-header';
import { SimilarSection } from '@/components/proposal/similar-section';
import { SubNav, type SubNavItem } from '@/components/proposal/sub-nav';
import { SummaryPanel } from '@/components/proposal/summary-panel';
import { TallySection } from '@/components/proposal/tally-section';
import { VotersTable } from '@/components/proposal/voters-table';
import { Section } from '@/components/ui/section';
import { serverApi } from '@/lib/api/client';
import {
  normalizeProposalDetail,
  presentTally,
  type ProposalDetailView,
  type TallyData,
} from '@/lib/proposals/detail';
import { sourceLabel } from '@/lib/proposals/source';
import { fetchVotesPage, type ProposalPath, type VotesPage } from '@/lib/proposals/votes';

const EMPTY_TALLY: TallyData = {
  choices: [],
  total_voting_power: '0',
  total_voters: 0,
  source: 'votes',
};

type Params = Promise<ProposalPath>;

const NAV: SubNavItem[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'description', label: 'Description' },
  { id: 'mismatch', label: 'Mismatch' },
  { id: 'actions', label: 'Actions' },
  { id: 'tally', label: 'Tally' },
  { id: 'voters', label: 'Voters' },
  { id: 'forum', label: 'Forum' },
  { id: 'similar', label: 'Similar' },
];

// Deduped within the request so generateMetadata and the page share one fetch.
const loadDetail = cache(async (path: ProposalPath): Promise<ProposalDetailView | null> => {
  const { data, error } = await serverApi().GET(
    '/v1/daos/{slug}/proposals/{source_type}/{source_id}',
    { params: { path } },
  );
  if (error || !data) return null;
  return normalizeProposalDetail(data.data);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const detail = await loadDetail(await params);
  if (!detail) return { title: 'Proposal not found — Kvorum' };
  const title = detail.title ?? `Proposal #${detail.sourceId}`;
  return {
    title: `${title} — ${detail.daoSlug} — Kvorum`,
    description: `${sourceLabel(detail.sourceType)} proposal in ${detail.daoSlug}: ${detail.description.slice(0, 160)}`,
  };
}

async function loadTally(path: ProposalPath): Promise<TallyData> {
  try {
    const { data, error } = await serverApi().GET(
      '/v1/daos/{slug}/proposals/{source_type}/{source_id}/tally',
      { params: { path } },
    );
    if (error || !data) return EMPTY_TALLY;
    return data.data;
  } catch {
    return EMPTY_TALLY; // a tally-fetch failure degrades the section, never 500s the page
  }
}

export default async function ProposalDetailPage({ params }: { params: Params }) {
  const path = await params;
  const detail = await loadDetail(path);
  if (!detail) notFound();

  // The tally is a cheap server-side aggregate; the voters table pages through the votes on its own,
  // so we SSR only its first page. Both degrade to empty rather than 500 the page.
  const [tally, initialVotes] = await Promise.all([
    loadTally(path),
    fetchVotesPage(serverApi(), path).catch<VotesPage>(() => ({ votes: [], nextCursor: null })),
  ]);
  const tallyTotalPower = presentTally(tally, detail.choices).totalPower;

  return (
    <div className="flex flex-col gap-8">
      <ProposalHeader detail={detail} />

      <div className="flex gap-10">
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          <Anchor id="summary">
            <SummaryPanel />
          </Anchor>
          <Anchor id="description">
            <DescriptionSection description={detail.description} />
          </Anchor>
          <Anchor id="mismatch">
            <MismatchSection />
          </Anchor>
          <Anchor id="actions">
            <ActionsSection detail={detail} />
          </Anchor>
          <Anchor id="tally">
            <TallySection tally={tally} detail={detail} />
          </Anchor>
          <Anchor id="voters">
            <Section number="06" title="Voters" reference={<span>{tally.total_voters} total</span>}>
              <VotersTable
                path={path}
                choices={detail.choices}
                initialPage={initialVotes}
                totalPower={tallyTotalPower}
              />
            </Section>
          </Anchor>
          <Anchor id="forum">
            <ForumSection links={detail.offchainLinks} />
          </Anchor>
          <Anchor id="similar">
            <SimilarSection />
          </Anchor>
        </div>

        <aside className="w-40 shrink-0">
          <SubNav items={NAV} />
        </aside>
      </div>
    </div>
  );
}

function Anchor({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      {children}
    </div>
  );
}
