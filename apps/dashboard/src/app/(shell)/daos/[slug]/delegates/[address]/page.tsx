import { Heatmap } from '@/components/charts/heatmap';
import { TimeSeries } from '@/components/charts/time-series';
import { DelegateHeader } from '@/components/delegate/delegate-header';
import { ParticipationGrid } from '@/components/delegate/participation-grid';
import { VoteHistory } from '@/components/delegate/vote-history';
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
  binding: null,
  startsMin: null,
  startsMax: null,
};

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

  return (
    <div className="flex flex-col gap-12">
      <DelegateHeader
        slug={slug}
        profile={profile}
        participationRate={grid.rate}
        trajectory={trajectory.values}
      />

      {trajectory.values.length > 1 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Voting-power trajectory</h2>
          <TimeSeries
            title="Voting power at each vote"
            buckets={trajectory.buckets}
            series={[{ label: 'Voting power', values: trajectory.values }]}
            formatValue={(v) => formatCompactNumber(v)}
            caption="The delegate's reported voting power at each vote (no dedicated VP-history endpoint yet)."
          />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Participation</h2>
        <ParticipationGrid cells={grid.cells} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Alignment</h2>
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
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Vote history</h2>
        <VoteHistory votes={votes} />
      </section>
    </div>
  );
}
