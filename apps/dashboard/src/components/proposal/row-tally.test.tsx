import { render, screen } from '@testing-library/react';

import { RowTally } from './row-tally';

describe('RowTally', () => {
  it('renders a labelled bar per bucket with the percentage', () => {
    render(
      <RowTally
        bars={[
          { kind: 'for', pct: 78 },
          { kind: 'against', pct: 19 },
          { kind: 'abstain', pct: 3 },
        ]}
      />,
    );

    // One accessible image summarising the whole tally for AT.
    expect(screen.getByRole('img', { name: 'For 78%, Agst 19%, Abst 3%' })).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('Agst')).toBeInTheDocument();
  });

  it('shows a dash when there are no votes, not an empty group', () => {
    render(<RowTally bars={[]} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
