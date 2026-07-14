import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TallySection } from './tally-section';
import type { ProposalDetailView, TallyData } from '@/lib/proposals/detail';

// The hook seeds from SSR initialData, so the default render needs no fetch; mock the client so any
// poll never hits the network.
vi.mock('@/lib/api/client', () => ({
  browserApi: {
    GET: vi.fn().mockResolvedValue({
      data: { data: null },
      response: { status: 304, headers: new Headers() },
    }),
  },
}));

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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderTally(detail: ProposalDetailView, tally: TallyData = votesTally) {
  return render(<TallySection tally={tally} detail={detail} />, { wrapper });
}

describe('TallySection', () => {
  it('renders the breakdown, participation, and leading outcome from the SSR seed', () => {
    renderTally(baseDetail());
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText('Voters')).toBeInTheDocument();
    const outcome = screen.getByText('Outcome (current)').parentElement;
    expect(outcome).toHaveTextContent('For');
  });

  it('exposes the tally to assistive tech via the bar aria-label', () => {
    renderTally(baseDetail());
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'For 75%, Against 25%');
  });

  it('shows a live freshness indicator while the proposal is active', () => {
    renderTally(baseDetail({ state: 'active' }));
    expect(screen.getByRole('status')).toHaveTextContent(/Updated/);
  });

  it('shows no polling indicator once the proposal has settled', () => {
    renderTally(baseDetail({ state: 'executed' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    renderTally(baseDetail({ sourceType: 'snapshot' }), tally);
    expect(screen.getByText('Per-choice scores')).toBeInTheDocument();
  });
});
