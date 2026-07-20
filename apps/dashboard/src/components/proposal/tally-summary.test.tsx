import { render, screen } from '@testing-library/react';

import { TallySummary } from './tally-summary';

describe('TallySummary', () => {
  it('renders a labelled bar per bucket with the percentage', () => {
    render(
      <TallySummary
        bars={[
          { kind: 'for', pct: 78 },
          { kind: 'against', pct: 19 },
          { kind: 'abstain', pct: 3 },
        ]}
      />,
    );

    // One accessible image summarising the whole tally for AT.
    expect(
      screen.getByRole('img', { name: 'for 78%, against 19%, abstain 3%' }),
    ).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('against')).toBeInTheDocument();
  });

  it('shows a dash when there are no votes, not an empty group', () => {
    render(<TallySummary bars={[]} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
