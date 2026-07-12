import { render, screen } from '@testing-library/react';

import { TallySection } from './tally-section';
import type { ProposalDetailView, VoteView } from '@/lib/proposals/detail';

const E18 = 1_000_000_000_000_000_000n;

function baseDetail(over: Partial<ProposalDetailView> = {}): ProposalDetailView {
  return {
    daoSlug: 'lido',
    sourceType: 'aragon_voting',
    sourceId: '42',
    title: 'A proposal',
    state: 'active',
    binding: true,
    votingStartsAt: null,
    votingEndsAt: null,
    proposer: { address: '0xabc', displayName: null },
    description: '',
    originChainId: '1',
    choices: [
      { index: 0, value: 'For' },
      { index: 1, value: 'Against' },
    ],
    actions: [],
    payloads: null,
    voting: null,
    metadata: null,
    offchainLinks: [],
    lastUpdatedAt: '2026-07-01T00:00:00Z',
    confirmed: true,
    ...over,
  };
}

function vote(power: bigint, choice: number): VoteView {
  return {
    voteId: `v${power}${choice}`,
    votingChainId: '1',
    voter: { address: '0x0', displayName: null },
    votingPowerReported: power.toString(),
    votingPowerVerified: true,
    primaryChoice: choice,
    castAt: null,
    reason: null,
  };
}

describe('TallySection', () => {
  const votes = [vote(300n * E18, 0), vote(100n * E18, 1)];

  it('renders the breakdown, participation, and leading outcome', () => {
    render(<TallySection detail={baseDetail()} votes={votes} partial={false} />);
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    // Voter count stat
    expect(screen.getByText('Voters')).toBeInTheDocument();
    // Leading outcome is "For"
    const outcome = screen.getByText('Outcome (current)').parentElement;
    expect(outcome).toHaveTextContent('For');
  });

  it('exposes the tally to assistive tech via the bar aria-label', () => {
    render(<TallySection detail={baseDetail()} votes={votes} partial={false} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'For 75%, Against 25%');
  });

  it('warns when the vote set was capped', () => {
    render(<TallySection detail={baseDetail()} votes={votes} partial />);
    expect(screen.getByText(/lower bound/)).toBeInTheDocument();
  });

  it('labels a Snapshot tally as coming from per-choice scores', () => {
    const detail = baseDetail({
      sourceType: 'snapshot',
      metadata: {
        kind: 'snapshot',
        space_id: 'lido-snapshot.eth',
        flagged: false,
        choice_scores: [100, 300],
      } as never,
    });
    render(<TallySection detail={detail} votes={votes} partial={false} />);
    expect(screen.getByText('per-choice scores')).toBeInTheDocument();
  });
});
