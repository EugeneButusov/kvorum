import { render, screen } from '@testing-library/react';

import { TallySection } from './tally-section';
import type { ProposalDetailView, TallyData } from '@/lib/proposals/detail';

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

const votesTally: TallyData = {
  source: 'votes',
  total_voting_power: (400n * E18).toString(),
  total_voters: 2,
  choices: [
    { choice_index: 0, voting_power: (300n * E18).toString(), voter_count: 1, pct: 75 },
    { choice_index: 1, voting_power: (100n * E18).toString(), voter_count: 1, pct: 25 },
  ],
};

describe('TallySection', () => {
  it('renders the breakdown, participation, and leading outcome', () => {
    render(<TallySection tally={votesTally} detail={baseDetail()} />);
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText('Voters')).toBeInTheDocument();
    const outcome = screen.getByText('Outcome (current)').parentElement;
    expect(outcome).toHaveTextContent('For');
  });

  it('exposes the tally to assistive tech via the bar aria-label', () => {
    render(<TallySection tally={votesTally} detail={baseDetail()} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'For 75%, Against 25%');
  });

  it('labels a Snapshot tally as coming from per-choice scores', () => {
    const tally: TallyData = {
      source: 'choice_scores',
      total_voting_power: '400',
      total_voters: 2,
      choices: [
        { choice_index: 0, voting_power: '100', voter_count: 1, pct: 25 },
        { choice_index: 1, voting_power: '300', voter_count: 1, pct: 75 },
      ],
    };
    render(<TallySection tally={tally} detail={baseDetail({ sourceType: 'snapshot' })} />);
    expect(screen.getByText('per-choice scores')).toBeInTheDocument();
  });
});
