import { render, screen } from '@testing-library/react';

import { RecentProposalsSection } from './recent-proposals-section';
import type { ProposalListItemView } from '@/lib/proposals/list';

function makeProposal(overrides: Partial<ProposalListItemView> = {}): ProposalListItemView {
  return {
    daoSlug: 'compound',
    sourceType: 'compound_governor',
    sourceId: '42',
    title: 'Adjust interest rates',
    state: 'Executed',
    binding: true,
    votingStartsAt: '2026-07-01T00:00:00Z',
    votingEndsAt: '2026-07-04T00:00:00Z',
    proposer: { address: '0x1234', displayName: null },
    tally: [
      { kind: 'for', pct: 95 },
      { kind: 'against', pct: 5 },
    ],
    href: '/daos/compound/proposals/compound_governor/42',
    ...overrides,
  };
}

describe('RecentProposalsSection', () => {
  it('renders proposal rows with titles and IDs', () => {
    render(<RecentProposalsSection proposals={[makeProposal()]} />);
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Adjust interest rates')).toBeInTheDocument();
  });

  it('shows state pills', () => {
    render(<RecentProposalsSection proposals={[makeProposal()]} />);
    expect(screen.getByText('Executed')).toBeInTheDocument();
  });

  it('shows vote splits from tally data', () => {
    render(<RecentProposalsSection proposals={[makeProposal()]} />);
    expect(screen.getByText('For 95% / Agst 5%')).toBeInTheDocument();
  });

  it('shows empty state when no proposals', () => {
    render(<RecentProposalsSection proposals={[]} />);
    expect(screen.getByText(/No proposals recorded/)).toBeInTheDocument();
  });

  it('links each row to the proposal detail page', () => {
    render(<RecentProposalsSection proposals={[makeProposal()]} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/daos/compound/proposals/compound_governor/42');
  });

  it('falls back to "Untitled" when proposal title is null', () => {
    render(<RecentProposalsSection proposals={[makeProposal({ title: null })]} />);
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });
});
