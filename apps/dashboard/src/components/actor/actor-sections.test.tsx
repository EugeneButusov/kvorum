import { render, screen, within } from '@testing-library/react';

import { ActorActivity } from './actor-lists';
import { CrossDaoAlignment } from './cross-dao-alignment';
import { CrossDaoTable } from './cross-dao-table';
import type { ActorVoteView, DaoFootprint } from '@/lib/actors/actor';

function fp(over: Partial<DaoFootprint> = {}): DaoFootprint {
  return {
    slug: 'compound',
    votingPower: 500000,
    votesCast: 12,
    proposalsProposed: 0,
    majorityAlignmentPct: 0.82,
    ...over,
  };
}

describe('CrossDaoTable', () => {
  it('renders a row per DAO with a scorecard link and formatted alignment', () => {
    render(
      <CrossDaoTable
        footprints={[fp({ slug: 'compound' }), fp({ slug: 'aave', majorityAlignmentPct: null })]}
        address="0xabc"
      />,
    );
    const rows = screen.getAllByRole('row').slice(1); // drop header
    expect(within(rows[0]!).getByText('compound')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('500K')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('82%')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute(
      'href',
      '/daos/compound/delegates/0xabc',
    );
    expect(within(rows[1]!).getByText('—')).toBeInTheDocument(); // null alignment
  });

  it('shows an empty state with no footprint', () => {
    render(<CrossDaoTable footprints={[]} address="0xabc" />);
    expect(screen.getByText(/No DAO participation/)).toBeInTheDocument();
  });
});

describe('CrossDaoAlignment', () => {
  it('renders the heatmap (with a table alternative) for a 2+ DAO delegate', () => {
    render(
      <CrossDaoAlignment
        footprints={[fp({ slug: 'compound' }), fp({ slug: 'aave', majorityAlignmentPct: 0.6 })]}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Alignment with the majority, by DAO' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View as table' })).toBeInTheDocument();
  });

  it('renders nothing when the actor is in fewer than two DAOs with alignment data', () => {
    const { container } = render(
      <CrossDaoAlignment
        footprints={[fp({ slug: 'compound' }), fp({ slug: 'aave', majorityAlignmentPct: null })]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ActorActivity', () => {
  function vote(over: Partial<ActorVoteView> = {}): ActorVoteView {
    return {
      voteId: 'v1',
      daoSlug: 'lido',
      sourceType: 'aragon_voting',
      sourceId: '42',
      title: 'Fund it',
      state: 'executed',
      primaryChoice: 1,
      choiceLabel: 'yes',
      castAt: '2026-07-01T00:00:00Z',
      href: '/daos/lido/proposals/aragon_voting/42',
      ...over,
    };
  }

  it('shows the proposal’s own vote label, not the raw choice index', () => {
    render(<ActorActivity votes={[vote({ choiceLabel: 'for' })]} />);

    expect(screen.getByText('for')).toBeInTheDocument();
    // The reported bug: the row rendered "choice #1" because no label reached the client.
    expect(screen.queryByText(/choice #/)).not.toBeInTheDocument();
  });

  it('falls back to the bare index only when the proposal declares no label', () => {
    render(<ActorActivity votes={[vote({ choiceLabel: null, primaryChoice: 3 })]} />);

    expect(screen.getByText('choice #3')).toBeInTheDocument();
  });

  it('renders an arbitrary off-chain choice label verbatim', () => {
    // Snapshot proposals carry author-defined choices — never coerced to for/against.
    render(<ActorActivity votes={[vote({ sourceType: 'snapshot', choiceLabel: 'Option A' })]} />);

    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('shows nothing choice-related when the vote carries neither label nor index', () => {
    render(<ActorActivity votes={[vote({ choiceLabel: null, primaryChoice: null })]} />);

    expect(screen.queryByText(/choice #/)).not.toBeInTheDocument();
  });
});
