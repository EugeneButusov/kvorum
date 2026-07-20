import { fireEvent, render, screen, within } from '@testing-library/react';

import { DelegateHeader } from './delegate-header';
import { ParticipationGrid } from './participation-grid';
import { VoteHistory } from './vote-history';
import type { DelegateVote, ParticipationCell } from '@/lib/analytics/delegate';

describe('ParticipationGrid', () => {
  const cells: ParticipationCell[] = [
    { key: 'snapshot:1', title: 'Fund it', voted: true, choiceIndex: 0 },
    { key: 'snapshot:2', title: 'Skip it', voted: false, choiceIndex: null },
  ];

  it('renders the grid and exposes a voted/choice table alternative', () => {
    render(<ParticipationGrid cells={cells} />);
    expect(screen.getByRole('img', { name: 'Participation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Fund it')).toBeInTheDocument();
    expect(within(table).getByText('Choice 1')).toBeInTheDocument();
    expect(within(table).getAllByText('No')).toHaveLength(1); // the missed proposal
  });
});

describe('DelegateHeader', () => {
  const profile = {
    address: '0x66cd62c6f8a4bb0cd8720488bcbd1a6221b765f9',
    name: null,
    currentPower: 80217,
    votesCast: 419,
    alignmentPct: 0.9139240506329114,
  };

  it('renders majority alignment as a percentage, not the raw fraction', () => {
    // The API field is named `_pct` but carries a fraction. Rounding it directly showed a delegate
    // aligned on 91% of votes as "1%", and disagreed with the cross-DAO table on the actor page,
    // which scales the same field by 100.
    render(
      <DelegateHeader slug="compound" profile={profile} participationRate={57} trajectory={[]} />,
    );

    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.queryByText('1%')).not.toBeInTheDocument();
  });

  it('shows a dash when alignment is unknown, rather than 0%', () => {
    render(
      <DelegateHeader
        slug="compound"
        profile={{ ...profile, alignmentPct: null }}
        participationRate={0}
        trajectory={[]}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('VoteHistory', () => {
  function vote(id: string, title: string, over: Partial<DelegateVote> = {}): DelegateVote {
    return {
      voteId: id,
      key: `snapshot:${id}`,
      sourceType: 'snapshot',
      title,
      state: 'executed',
      choice: 1,
      power: 100,
      castAt: '2026-05-01T00:00:00Z',
      href: `/daos/lido/proposals/snapshot/${id}`,
      ...over,
    };
  }

  it('lists votes, linking the proposal title to its detail', () => {
    render(<VoteHistory votes={[vote('1', 'First proposal')]} />);
    expect(screen.getByRole('link', { name: 'First proposal' })).toHaveAttribute(
      'href',
      '/daos/lido/proposals/snapshot/1',
    );
    expect(screen.getByText('Choice 2')).toBeInTheDocument(); // choice index 1 → "Choice 2"
  });

  it('shows an empty state with no votes', () => {
    render(<VoteHistory votes={[]} />);
    expect(screen.getByText(/No votes recorded/)).toBeInTheDocument();
  });
});
