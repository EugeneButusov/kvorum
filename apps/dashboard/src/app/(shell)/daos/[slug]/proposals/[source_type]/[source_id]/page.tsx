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
import { SystemPage } from '@/components/system/system-page';
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
import { SITE_URL } from '@/lib/site';

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

// A reachable API that 404s means the proposal doesn't exist (→ notFound); an unreachable API means
// the data is temporarily unavailable (→ a graceful 200 shell, never a 500).
type DetailResult =
  | { status: 'ok'; detail: ProposalDetailView }
  | { status: 'not-found' }
  | { status: 'unavailable' };

function canonicalPath(path: ProposalPath): string {
  return `/daos/${path.slug}/proposals/${path.source_type}/${path.source_id}`;
}

// Deduped within the request so generateMetadata and the page share one fetch.
const loadDetail = cache(async (path: ProposalPath): Promise<DetailResult> => {
  let result;
  try {
    result = await serverApi().GET('/v1/daos/{slug}/proposals/{source_type}/{source_id}', {
      params: { path },
    });
  } catch {
    return { status: 'unavailable' };
  }
  const { data, error } = result;
  if (error || !data) return { status: 'not-found' };
  return { status: 'ok', detail: normalizeProposalDetail(data.data) };
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const path = await params;
  const result = await loadDetail(path);
  const canonical = canonicalPath(path);
  if (result.status === 'not-found') return { title: 'Proposal not found — Kvorum' };
  if (result.status === 'unavailable') {
    return {
      title: 'Proposal — Kvorum',
      description: 'Governance proposal details on Kvorum.',
      alternates: { canonical },
    };
  }
  const { detail } = result;
  const title = `${detail.title ?? `Proposal #${detail.sourceId}`} — ${detail.daoSlug} — Kvorum`;
  const description = `${sourceLabel(detail.sourceType)} proposal in ${detail.daoSlug}: ${detail.description.slice(0, 160)}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: `${SITE_URL}${canonical}`, type: 'article' },
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
  const result = await loadDetail(path);
  if (result.status === 'not-found') notFound();
  if (result.status === 'unavailable') {
    return (
      <SystemPage
        code="Temporarily unavailable"
        title="This proposal couldn’t be loaded"
        actions={[
          { label: `${path.slug} proposals`, href: `/daos/${path.slug}/proposals` },
          { label: '← Home', href: '/' },
        ]}
      >
        Kvorum couldn’t reach its data source for this proposal just now. This is on our side —
        please try again in a moment.
      </SystemPage>
    );
  }
  const detail = result.detail;

  // The tally is a cheap server-side aggregate; the voters table pages through the votes on its own,
  // so we SSR only its first page. Both degrade to empty rather than 500 the page.
  const [tally, initialVotes] = await Promise.all([
    loadTally(path),
    fetchVotesPage(serverApi(), path).catch<VotesPage>(() => ({ votes: [], nextCursor: null })),
  ]);
  const tallyTotalPower = presentTally(tally, detail.choices).totalPower;

  return (
    <div className="mx-auto w-full max-w-[var(--max-page)] lg:grid lg:grid-cols-[var(--aside-w)_minmax(0,1fr)]">
      {/* Sticky TOC — the reference pins the aside itself (a direct grid child with room to move),
          NOT an inner list. On mobile it's dropped and the sections read top-to-bottom (KNOWN-019). */}
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-fit lg:self-start lg:border-r lg:border-line-3 lg:bg-bg lg:py-6">
        <SubNav items={NAV} />
      </aside>

      <main className="flex min-w-0 flex-col gap-9 px-4 py-7 lg:px-9 lg:pb-16">
        <ProposalHeader detail={detail} />

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
      </main>
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
