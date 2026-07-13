import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ConcentrationSection } from './concentration-section';
import type { ConcentrationView } from '@/lib/analytics/health';

vi.mock('@/lib/api/client', () => ({ browserApi: { GET: vi.fn() } }));

const view: ConcentrationView = {
  buckets: ['Jan', 'Feb', 'Mar'],
  gini: [0.4, 0.45, 0.5],
  bands: [
    { label: 'Top 1', values: [10, 12, 15] },
    { label: 'Top 2–5', values: [20, 21, 22] },
    { label: 'Top 6–10', values: [15, 15, 14] },
    { label: 'Top 11–20', values: [10, 9, 9] },
  ],
  current: { gini: 0.5, top10Pct: 45 },
  delta90Top10: 6,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('ConcentrationSection', () => {
  it('renders the range selector, current stats, and both charts', () => {
    render(<ConcentrationSection slug="lido" initial={view} />, { wrapper });

    expect(screen.getByRole('button', { name: '90 days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Gini').closest('div')).toHaveTextContent('0.50'); // current gini stat
    expect(screen.getByText('+6.0pp')).toBeInTheDocument(); // 90-day delta
    expect(screen.getByRole('img', { name: 'Gini coefficient' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Top-holder share' })).toBeInTheDocument();
  });

  it('shows an empty state when the range has no data', () => {
    const empty: ConcentrationView = { ...view, buckets: [], gini: [], current: null };
    render(<ConcentrationSection slug="lido" initial={empty} />, { wrapper });
    expect(screen.getByText(/No concentration data/)).toBeInTheDocument();
  });
});
