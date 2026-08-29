import { render, screen } from '@testing-library/react';

import { TrendsSection } from './trends-section';
import type { PassRateView } from '@/lib/analytics/health';

const passRate: PassRateView = {
  buckets: ['2026-05', '2026-06', '2026-07'],
  series: [{ label: 'compound_governor', values: [60, 70, 80] }],
  overallPct: 72.5,
  sparklineValues: [60, 70, 80],
};

describe('TrendsSection', () => {
  it('renders three sparkline cards', () => {
    render(<TrendsSection passRate={passRate} />);
    expect(screen.getByText('Participation rate')).toBeInTheDocument();
    expect(screen.getByText('Pass rate')).toBeInTheDocument();
    expect(screen.getByText('Forum activity')).toBeInTheDocument();
  });

  it('shows the overall pass rate value', () => {
    render(<TrendsSection passRate={passRate} />);
    expect(screen.getByText('72.5%')).toBeInTheDocument();
  });

  it('shows coming-soon placeholder for participation and forum', () => {
    render(<TrendsSection passRate={passRate} />);
    const pending = screen.getAllByText('endpoint pending');
    expect(pending).toHaveLength(2);
  });

  it('displays an em-dash when overall pass rate is null', () => {
    render(<TrendsSection passRate={{ ...passRate, overallPct: null, sparklineValues: [] }} />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
