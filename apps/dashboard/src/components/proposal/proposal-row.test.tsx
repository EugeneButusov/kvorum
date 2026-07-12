import { render, screen } from '@testing-library/react';

import { ProposalRow } from './proposal-row';
import type { ProposalListItemView } from '@/lib/proposals/list';

function item(over: Partial<ProposalListItemView> = {}): ProposalListItemView {
  return {
    daoSlug: 'lido',
    sourceType: 'aragon_voting',
    sourceId: '42',
    title: 'Fund the treasury',
    state: 'active',
    binding: true,
    votingStartsAt: null,
    votingEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    proposer: { address: '0xabc', displayName: null },
    href: '/daos/lido/proposals/aragon_voting/42',
    ...over,
  };
}

describe('ProposalRow', () => {
  it('renders the badge, title, source, state, and close time, linking to the detail', () => {
    render(<ProposalRow item={item()} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/daos/lido/proposals/aragon_voting/42');
    expect(screen.getByRole('heading', { name: 'Fund the treasury' })).toBeInTheDocument();
    expect(screen.getByText('lido')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Aragon voting')).toBeInTheDocument();
    expect(screen.getByText(/ends in 3d/)).toBeInTheDocument();
  });

  it('hides the DAO badge in the DAO-scoped list', () => {
    render(<ProposalRow item={item()} showDao={false} />);
    expect(screen.queryByText('lido')).not.toBeInTheDocument();
  });

  it('flags signaling proposals and falls back to an id-based title', () => {
    render(<ProposalRow item={item({ binding: false, title: null })} />);
    expect(screen.getByText('signaling')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Proposal #42' })).toBeInTheDocument();
  });
});
