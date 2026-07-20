import { render, screen } from '@testing-library/react';

import { ProposalCard } from './proposal-card';
import type { ProposalListItemView } from '../../lib/proposals/list';

function item(overrides: Partial<ProposalListItemView> = {}): ProposalListItemView {
  return {
    daoSlug: 'compound',
    sourceType: 'compound_governor_oz',
    sourceId: '591',
    title: 'Deprecation of Polygon and Unichain Comets',
    state: 'queued',
    binding: true,
    votingStartsAt: null,
    votingEndsAt: null,
    proposer: { address: '0x7b3cabcdefabcdefabcdefabcdefabcdefabcc33', displayName: null },
    tally: [
      { kind: 'for', pct: 75 },
      { kind: 'against', pct: 25 },
    ],
    href: '/daos/compound/proposals/compound_governor_oz/591',
    ...overrides,
  };
}

describe('ProposalCard', () => {
  it('carries the same fields the desktop table columns do', () => {
    render(<ProposalCard item={item()} showDao />);

    expect(screen.getByText('#591')).toBeInTheDocument();
    expect(screen.getByText(/Deprecation of Polygon/)).toBeInTheDocument();
    expect(screen.getByText('compound')).toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();
    expect(screen.getByText(/proposer 0x7b3c/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'for 75%, against 25%' })).toBeInTheDocument();
  });

  it('links to the proposal', () => {
    render(<ProposalCard item={item()} showDao />);

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/daos/compound/proposals/compound_governor_oz/591',
    );
  });

  it('hides the DAO pill when the list is already DAO-scoped', () => {
    render(<ProposalCard item={item()} showDao={false} />);

    expect(screen.queryByText('compound')).not.toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();
  });

  it('omits the tally when the proposal has no votes, rather than showing an empty dash row', () => {
    render(<ProposalCard item={item({ tally: [] })} showDao />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to the id when a proposal has no title', () => {
    render(<ProposalCard item={item({ title: null })} showDao />);

    expect(screen.getByText(/Proposal #591/)).toBeInTheDocument();
  });

  it('uses the source id verbatim when it is not numeric (no bogus "#")', () => {
    render(<ProposalCard item={item({ sourceId: '0xfeed' })} showDao />);

    expect(screen.getByText('0xfeed')).toBeInTheDocument();
  });
});
