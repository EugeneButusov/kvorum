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
import { normalizeProposalDetail, type ProposalDetailView } from '@/lib/proposals/detail';
import { sourceLabel } from '@/lib/proposals/source';
import { fetchAllVotes, type ProposalPath } from '@/lib/proposals/votes';

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

export default async function ProposalDetailPage({ params }: { params: Params }) {
  const path = await params;
  const detail = await loadDetail(path);
  if (!detail) notFound();

  // Votes back both the tally and the voters table; a failure degrades to an empty tally, not a 500.
  let votes: Awaited<ReturnType<typeof fetchAllVotes>>['votes'] = [];
  let partial = false;
  try {
    ({ votes, partial } = await fetchAllVotes(serverApi(), path));
  } catch {
    votes = [];
  }

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
            <TallySection detail={detail} votes={votes} partial={partial} />
          </Anchor>
          <Anchor id="voters">
            <Section number="06" title="Voters" reference={<span>{votes.length} counted</span>}>
              <VotersTable votes={votes} choices={detail.choices} />
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
