import { render, screen } from '@testing-library/react';

import { TrendsSection } from './trends-section';
import type { ForumActivityView, ParticipationView, PassRateView } from '@/lib/analytics/health';

const passRate: PassRateView = {
  buckets: ['2026-05', '2026-06', '2026-07'],
  series: [{ label: 'compound_governor', values: [60, 70, 80] }],
  overallPct: 72.5,
  sparklineValues: [60, 70, 80],
};

const participation: ParticipationView = {
  buckets: ['2026-05', '2026-06', '2026-07'],
  series: [{ label: 'compound_governor', values: [20, 25, 30] }],
  overallPct: 25.5,
  sparklineValues: [20, 25, 30],
};

const forumActivity: ForumActivityView = {
  sparklineValues: [42, 58, 31],
  currentValue: '31',
};

const emptyParticipation: ParticipationView = {
  buckets: [],
  series: [],
  overallPct: null,
  sparklineValues: [],
};

const emptyForumActivity: ForumActivityView = {
  sparklineValues: [],
  currentValue: '—',
};

describe('TrendsSection', () => {
  it('renders three sparkline cards', () => {
    render(
      <TrendsSection
        passRate={passRate}
        participation={participation}
        forumActivity={forumActivity}
      />,
    );
    expect(screen.getByText('Participation rate')).toBeInTheDocument();
    expect(screen.getByText('Pass rate')).toBeInTheDocument();
    expect(screen.getByText('Forum activity')).toBeInTheDocument();
  });

  it('shows the overall pass rate value', () => {
    render(
      <TrendsSection
        passRate={passRate}
        participation={participation}
        forumActivity={forumActivity}
      />,
    );
    expect(screen.getByText('72.5%')).toBeInTheDocument();
  });

  it('shows the overall participation rate value', () => {
    render(
      <TrendsSection
        passRate={passRate}
        participation={participation}
        forumActivity={forumActivity}
      />,
    );
    expect(screen.getByText('25.5%')).toBeInTheDocument();
  });

  it('shows the forum activity current value', () => {
    render(
      <TrendsSection
        passRate={passRate}
        participation={participation}
        forumActivity={forumActivity}
      />,
    );
    expect(screen.getByText('31')).toBeInTheDocument();
  });

  it('displays an em-dash when participation rate is null', () => {
    render(
      <TrendsSection
        passRate={passRate}
        participation={emptyParticipation}
        forumActivity={emptyForumActivity}
      />,
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('displays an em-dash when overall pass rate is null', () => {
    render(
      <TrendsSection
        passRate={{ ...passRate, overallPct: null, sparklineValues: [] }}
        participation={emptyParticipation}
        forumActivity={emptyForumActivity}
      />,
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
