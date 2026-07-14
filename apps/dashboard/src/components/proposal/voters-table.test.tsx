import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { sortToParam, VotersTable } from './voters-table';
import type { VoteView } from '@/lib/proposals/detail';
import type { VotesPage } from '@/lib/proposals/votes';

// Safety net: the initialData seed means the default view renders without a fetch, but mock the
// client so any background/interaction fetch never hits the network.
vi.mock('@/lib/api/client', () => ({
  browserApi: {
    GET: vi.fn().mockResolvedValue({ data: { data: [], pagination: {} }, error: null }),
  },
}));

const E18 = 1_000_000_000_000_000_000n;

const CHOICES = [
  { index: 0, value: 'For' },
  { index: 1, value: 'Against' },
];

function vote(name: string, power: bigint, choice: number): VoteView {
  return {
    voteId: `v-${name}`,
    votingChainId: '1',
    voter: { address: `0x${name.padEnd(40, '0')}`, displayName: name },
    votingPowerReported: power.toString(),
    votingPowerVerified: true,
    primaryChoice: choice,
    castAt: '2026-07-01T00:00:00Z',
    reason: null,
  };
}

// SSR first page, power-descending (the endpoint's default sort).
const initialPage: VotesPage = {
  votes: [vote('whale', 500n * E18, 0), vote('mid', 100n * E18, 0), vote('small', 10n * E18, 1)],
  nextCursor: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PATH = { slug: 'lido', source_type: 'aragon_voting', source_id: '42' };

describe('sortToParam', () => {
  it.each([
    [[{ id: 'power', desc: true }], '-voting_power_reported'],
    [[{ id: 'power', desc: false }], 'voting_power_reported'],
    [[{ id: 'castAt', desc: true }], '-cast_at'],
    [[{ id: 'castAt', desc: false }], 'cast_at'],
    [[], '-voting_power_reported'],
  ] as const)('%o → %s', (sorting, expected) => {
    expect(sortToParam([...sorting])).toBe(expected);
  });
});

describe('VotersTable', () => {
  it('renders the SSR first page in the given order', () => {
    render(
      <VotersTable path={PATH} choices={CHOICES} initialPage={initialPage} totalPower={610} />,
      { wrapper },
    );
    const rows = screen.getAllByRole('row').slice(1); // drop header
    expect(within(rows[0]!).getByText('whale')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('small')).toBeInTheDocument();
    expect(screen.getByText('Showing 3')).toBeInTheDocument();
  });

  it('exposes a choice filter chip per declared choice', () => {
    render(
      <VotersTable path={PATH} choices={CHOICES} initialPage={initialPage} totalPower={610} />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'For' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Against' })).toBeInTheDocument();
  });

  it('computes % of total against the tally total, not the loaded set', () => {
    render(
      <VotersTable path={PATH} choices={CHOICES} initialPage={initialPage} totalPower={1000} />,
      { wrapper },
    );
    // whale 500 / 1000 = 50%
    expect(screen.getByText('50.00%')).toBeInTheDocument();
  });

  it('renders an empty state with no votes', () => {
    render(
      <VotersTable
        path={PATH}
        choices={CHOICES}
        initialPage={{ votes: [], nextCursor: null }}
        totalPower={0}
      />,
      { wrapper },
    );
    expect(screen.getByText(/No votes recorded/)).toBeInTheDocument();
  });
});
