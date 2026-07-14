import { render, screen, within } from '@testing-library/react';

import { HealthSnapshot } from './health-snapshot';
import { TopDelegates } from './top-delegates';
import type { TopDelegate } from '@/lib/analytics/health';

describe('HealthSnapshot', () => {
  it('renders the headline metrics and links to the full dashboard', () => {
    render(<HealthSnapshot slug="lido" gini={0.42} top10Pct={38.5} passRatePct={71} />);
    expect(screen.getByText('Gini').closest('div')).toHaveTextContent('0.42');
    expect(screen.getByText('38.5%')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Full dashboard/ })).toHaveAttribute(
      'href',
      '/daos/lido/health',
    );
  });

  it('shows an em dash for missing metrics', () => {
    render(<HealthSnapshot slug="lido" gini={null} top10Pct={null} passRatePct={null} />);
    expect(screen.getAllByText('—')).toHaveLength(3);
  });
});

describe('TopDelegates', () => {
  const delegates: TopDelegate[] = [
    { address: '0xaaa', label: 'whale.eth', power: 500000 },
    { address: '0xbbb', label: 'Gauntlet', power: 120000 },
  ];

  it('ranks delegates and links each to its scorecard', () => {
    render(<TopDelegates slug="lido" delegates={delegates} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('whale.eth')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute(
      'href',
      '/daos/lido/delegates/0xaaa',
    );
    expect(within(rows[0]!).getByText('500K')).toBeInTheDocument();
  });

  it('shows an empty state with no delegates', () => {
    render(<TopDelegates slug="lido" delegates={[]} />);
    expect(screen.getByText(/No delegate voting power/)).toBeInTheDocument();
  });
});
