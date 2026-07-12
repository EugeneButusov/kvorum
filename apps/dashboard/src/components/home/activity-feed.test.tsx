import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ActivityFeed } from './activity-feed';
import type { ProposalListItemView } from '@/lib/proposals/list';

vi.mock('@/lib/api/client', () => ({
  browserApi: {
    GET: vi.fn().mockResolvedValue({
      data: { data: null },
      response: { status: 304, headers: new Headers() },
    }),
  },
}));

function item(id: string, title: string): ProposalListItemView {
  return {
    daoSlug: 'lido',
    sourceType: 'aragon_voting',
    sourceId: id,
    title,
    state: 'executed',
    binding: true,
    votingStartsAt: null,
    votingEndsAt: null,
    proposer: { address: '0xabc', displayName: null },
    href: `/daos/lido/proposals/aragon_voting/${id}`,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('ActivityFeed', () => {
  it('renders the recent proposals with a live freshness indicator', () => {
    render(<ActivityFeed initialItems={[item('1', 'Recent one')]} />, { wrapper });
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent one' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Updated/);
  });

  it('shows an empty state when there is no activity', () => {
    render(<ActivityFeed initialItems={[]} />, { wrapper });
    expect(screen.getByText(/No recent governance activity/)).toBeInTheDocument();
  });
});
