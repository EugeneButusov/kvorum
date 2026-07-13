import { fireEvent, render, screen, within } from '@testing-library/react';

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
