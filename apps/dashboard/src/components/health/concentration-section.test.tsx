import { render, screen } from '@testing-library/react';

import { ConcentrationSection } from './concentration-section';
import type { ConcentrationView, LorenzBar } from '@/lib/analytics/health';
import type { DelegateLeaderboardEntry } from '@/lib/daos/delegates';

const concentration: ConcentrationView = {
  buckets: ['Jan', 'Feb', 'Mar'],
  gini: [0.4, 0.45, 0.5],
  bands: [
    { label: 'Top 1', values: [10, 12, 15] },
    { label: 'Top 2–5', values: [20, 21, 22] },
    { label: 'Top 6–10', values: [15, 15, 14] },
    { label: 'Top 11–20', values: [10, 9, 9] },
  ],
  current: { gini: 0.74, top10Pct: 42.7 },
  delta90Top10: 3.2,
};

const delegates: DelegateLeaderboardEntry[] = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1,
  address: `0x${String(i).padStart(40, '0')}`,
  displayName: `Delegate ${i + 1}`,
  votingPower: 100 - i * 8,
  sharePct: 12 - i,
  delegatorCount: 5,
  href: `/daos/compound/delegates/0x${String(i).padStart(40, '0')}`,
}));

const lorenzBars: LorenzBar[] = Array.from({ length: 20 }, (_, i) => ({
  rank: i + 1,
  cumulativePct: ((i + 1) / 20) * 100,
  isTopQuintile: i >= 16,
}));

describe('ConcentrationSection', () => {
  it('renders the top-10 table and Lorenz histogram', () => {
    render(
      <ConcentrationSection
        delegates={delegates}
        concentration={concentration}
        lorenzBars={lorenzBars}
      />,
    );

    expect(screen.getByText('Top-10 holders')).toBeInTheDocument();
    expect(screen.getByText('Delegate 1')).toBeInTheDocument();
    expect(screen.getByText('Delegate 10')).toBeInTheDocument();
    expect(screen.getByText('42.7% of VP')).toBeInTheDocument();
  });

  it('shows the Gini callout in the Lorenz histogram', () => {
    render(
      <ConcentrationSection
        delegates={delegates}
        concentration={concentration}
        lorenzBars={lorenzBars}
      />,
    );

    expect(screen.getByText(/Gini 0\.74/)).toBeInTheDocument();
  });

  it('shows empty state when no delegates are available', () => {
    render(<ConcentrationSection delegates={[]} concentration={concentration} lorenzBars={[]} />);
    expect(screen.getByText(/No delegate data/)).toBeInTheDocument();
  });
});
