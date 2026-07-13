import { render, screen } from '@testing-library/react';

import { ProposalCard } from './proposal-card';
import type { ProposalListItemView } from '@/lib/proposals/list';

const item: ProposalListItemView = {
  daoSlug: 'lido',
  sourceType: 'snapshot',
  sourceId: '0xabc',
  title: 'Fund the treasury',
  state: 'active',
  binding: true,
  votingStartsAt: null,
  votingEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  proposer: { address: '0xabc', displayName: null },
  href: '/daos/lido/proposals/snapshot/0xabc',
};

describe('ProposalCard', () => {
  it('renders the badge, title, source, and close time, linking to the detail', () => {
    render(<ProposalCard item={item} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/daos/lido/proposals/snapshot/0xabc');
    expect(screen.getByRole('heading', { name: 'Fund the treasury' })).toBeInTheDocument();
    expect(screen.getByText('Snapshot')).toBeInTheDocument();
    expect(screen.getByText(/ends in 3d/)).toBeInTheDocument();
  });
});
