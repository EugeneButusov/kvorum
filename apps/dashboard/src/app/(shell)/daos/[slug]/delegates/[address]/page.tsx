import { Heatmap } from '@/components/charts/heatmap';
import { TimeSeries } from '@/components/charts/time-series';
import { DelegateIdentity } from '@/components/delegate/delegate-identity';
import { KpiStrip, type Kpi } from '@/components/delegate/kpi-strip';
import { ParticipationGrid } from '@/components/delegate/participation-grid';
import { Section } from '@/components/delegate/section';
import { VoteHistory } from '@/components/delegate/vote-history';
import { AIPanel } from '@/components/ui/ai-panel';
import {
  fetchAlignment,
  fetchDelegateProfile,
  fetchDelegateVotes,
  participation,
  powerTrajectory,
} from '@/lib/analytics/delegate';
import { serverApi } from '@/lib/api/client';
import { formatCompactNumber } from '@/lib/format';
import { fetchProposalPage, type ProposalFilters } from '@/lib/proposals/list';

const ALL_STATES: ProposalFilters = {
  dao: [],
  state: [],
};

/**
 * Delegate scorecard (§6.11), laid out after the hi-fi `delegate.html`: identity header, KPI strip,
 * then numbered sections.
 *
 * The reference is a cross-DAO profile; this page is DAO-scoped, so its "voting power across DAOs"
 * table has no place here — that content is §6.10, on /actors/{address}, which the header now links
 * to. The reference's forum-activity and disclosed-conflicts panels are omitted rather than stubbed:
 * there is no actor→forum-post endpoint and conflicts are not modelled at all, so a placeholder
 * would promise data that has no source (ADR-086).
 */
export default async function DelegateScorecardPage({
  params,
}: {
  params: Promise<{ slug: string; address: string }>;
}) {
  const { slug, address } = await params;

  const [profile, votes, proposalsPage, alignment] = await Promise.all([
    fetchDelegateProfile(serverApi(), slug, address),
    fetchDelegateVotes(serverApi(), slug, address),
    fetchProposalPage(serverApi(), {
      slug,
      filters: ALL_STATES,
      sort: { field: 'created_at', dir: 'desc' },
    }).catch(() => ({ items: [], nextCursor: null })),
    fetchAlignment(serverApi(), slug, address),
  ]);

  const grid = participation(proposalsPage.items, votes);
  const trajectory = powerTrajectory(votes);
  const votedInWindow = grid.cells.filter((cell) => cell.voted).length;

  const kpis: Kpi[] = [
    {
      label: 'Voting power',
      value: profile.currentPower == null ? null : formatCompactNumber(profile.currentPower),
      sub: profile.currentPower == null ? 'no delegation recorded' : 'delegated to this address',
    },
    {
      label: 'Proposals voted',
      value: profile.votesCast,
      sub: 'all-time in this DAO',
    },
    {
      label: 'Particip. rate',
      value: grid.cells.length === 0 ? null : `${grid.rate}%`,
      sub:
        grid.cells.length === 0
          ? 'no proposals to compare'
          : `of last ${grid.cells.length} proposals`,
      tone: 'accent',
    },
    {
      label: 'Majority alignment',
      value: profile.alignmentPct == null ? null : `${Math.round(profile.alignmentPct * 100)}%`,
      sub: profile.alignmentPct == null ? 'no resolved votes yet' : 'voted with the outcome',
    },
    {
      // The reference shows "w/ rationale" here. Rationales are not captured by any source we
      // ingest, so the cell states that rather than showing a zero that would read as "never
      // explains a vote".
      label: 'w/ rationale',
      value: null,
      sub: 'rationales not captured yet',
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <DelegateIdentity slug={slug} profile={profile} />

      <KpiStrip items={kpis} />

      <Section
        number="01"
        title="Voting profile · synthesis"
        reference={`${votes.length} votes on file`}
      >
        <AIPanel
          state="coming-soon"
          label="Voting profile by Kvorum"
          comingSoonLabel="A synthesis of this delegate's voting pattern"
          fallbackHref={`/daos/${slug}/delegates/${address}#vote-history`}
          fallbackLabel="Read the voting record below"
        />
      </Section>

      {trajectory.values.length > 1 && (
        <Section number="02" title="Voting-power trajectory" reference="reported at each vote">
          <TimeSeries
            title="Voting power at each vote"
            buckets={trajectory.buckets}
            series={[{ label: 'Voting power', values: trajectory.values }]}
            formatValue={(v) => formatCompactNumber(v)}
            caption="The delegate's reported voting power at each vote (no dedicated VP-history endpoint yet)."
          />
        </Section>
      )}

      <Section
        number="03"
        title="Participation"
        reference={`${votedInWindow} of ${grid.cells.length} recent proposals`}
      >
        <ParticipationGrid cells={grid.cells} />
      </Section>

      <Section
        number="04"
        title="Alignment"
        reference={
          alignment.rowLabels.length === 0
            ? 'no shared votes'
            : `${alignment.rowLabels.length} peer delegates`
        }
      >
        {alignment.rowLabels.length === 0 ? (
          <p className="font-mono text-mono-body text-ink-3">
            Not enough shared votes to compute alignment with peers.
          </p>
        ) : (
          <Heatmap
            title="Alignment with peer delegates"
            rowLabels={alignment.rowLabels}
            colLabels={['Alignment']}
            cells={alignment.cells}
            domain={[0, 100]}
            formatValue={(v) => `${v}%`}
            caption="Share of shared proposals this delegate voted the same way on."
          />
        )}
      </Section>

      <Section number="05" title="Voting record" reference={`${votes.length} votes`}>
        <div id="vote-history">
          <VoteHistory votes={votes} />
        </div>
      </Section>
    </div>
  );
}
