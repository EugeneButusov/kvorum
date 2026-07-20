import { fireEvent, render, screen, within } from '@testing-library/react';

import { KpiStrip } from './kpi-strip';
import { ParticipationGrid } from './participation-grid';
import { VoteHistory } from './vote-history';
import type { DelegateVote, ParticipationCell } from '@/lib/analytics/delegate';

describe('ParticipationGrid', () => {
  const cells: ParticipationCell[] = [
    { key: 'snapshot:1', title: 'Fund it', voted: true, choiceIndex: 0, choiceLabel: 'For' },
    { key: 'snapshot:2', title: 'Skip it', voted: false, choiceIndex: null, choiceLabel: null },
  ];

  it('renders the grid and exposes a voted/choice table alternative', () => {
    render(<ParticipationGrid cells={cells} />);
    expect(screen.getByRole('img', { name: 'Participation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Fund it')).toBeInTheDocument();
    // Was 'Choice 1'. The proposal names its own choices; an index means nothing to a reader.
    expect(within(table).getByText('For')).toBeInTheDocument();
    expect(within(table).getAllByText('No')).toHaveLength(1); // the missed proposal
  });
});

describe('KpiStrip', () => {
  it('renders an em-dash and the reason when a figure is not measured', () => {
    // An unmeasured KPI must never render as 0 — that reads as a real, bad number (ADR-086).
    render(
      <KpiStrip
        items={[{ label: 'w/ rationale', value: null, sub: 'rationales not captured yet' }]}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('rationales not captured yet')).toBeInTheDocument();
  });

  it('renders a measured figure with its supporting context', () => {
    render(
      <KpiStrip items={[{ label: 'Particip. rate', value: '90%', sub: 'of last 50 proposals' }]} />,
    );

    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('of last 50 proposals')).toBeInTheDocument();
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
      choiceLabel: 'For',
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
    // Was 'Choice 2' — the component rendered index+1 while the API was already sending the
    // proposal's own label, so every Compound vote read as "Choice 2" instead of "For".
    expect(screen.getByText('For')).toBeInTheDocument();
  });

  it('shows an empty state with no votes', () => {
    render(<VoteHistory votes={[]} />);
    expect(screen.getByText(/No votes recorded/)).toBeInTheDocument();
  });
});
