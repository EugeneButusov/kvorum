import { render, screen } from '@testing-library/react';

import { HealthHeader, type HealthKpi } from './health-header';

const kpis: HealthKpi[] = [
  { label: 'Pass rate (1y)', value: '71%' },
  { label: 'Top-10 VP', value: '42.7%', deltaPp: 3.2, higherIsWorse: true },
  { label: 'Gini', value: '0.74', higherIsWorse: true },
];

describe('HealthHeader', () => {
  it('renders the operator framing and the DAO name', () => {
    render(<HealthHeader name="Compound" slug="compound" kpis={kpis} />);
    expect(screen.getByRole('heading', { name: 'Compound — health' })).toBeInTheDocument();
    expect(screen.getByText(/Stewarding Compound\?/)).toBeInTheDocument();
  });

  it('links to the DAO surfaces an operator jumps to next', () => {
    render(<HealthHeader name="Compound" slug="compound" kpis={kpis} />);
    expect(screen.getByRole('link', { name: 'View proposals →' })).toHaveAttribute(
      'href',
      '/daos/compound/proposals',
    );
    expect(screen.getByRole('link', { name: 'Top delegates →' })).toHaveAttribute(
      'href',
      '/daos/compound/delegates',
    );
  });

  it('renders each headline metric', () => {
    render(<HealthHeader name="Compound" slug="compound" kpis={kpis} />);
    expect(screen.getByText('Pass rate (1y)')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('0.74')).toBeInTheDocument();
  });

  it('marks a rise in concentration as a concern, not an improvement', () => {
    render(<HealthHeader name="Compound" slug="compound" kpis={kpis} />);
    const delta = screen.getByText(/3\.2pp/);
    expect(delta).toHaveTextContent('↑');
    // higherIsWorse: rising concentration is a warning, never the positive brand green.
    expect(delta.className).toContain('text-warn');
  });

  it('treats a falling concentration as an improvement', () => {
    render(
      <HealthHeader
        name="Compound"
        slug="compound"
        kpis={[{ label: 'Top-10 VP', value: '40%', deltaPp: -2, higherIsWorse: true }]}
      />,
    );
    const delta = screen.getByText(/2\.0pp/);
    expect(delta).toHaveTextContent('↓');
    expect(delta.className).toContain('text-primary');
  });

  it('omits the delta when there is not enough history to compute one', () => {
    render(
      <HealthHeader
        name="Compound"
        slug="compound"
        kpis={[{ label: 'Top-10 VP', value: '40%', deltaPp: null }]}
      />,
    );
    expect(screen.queryByText(/pp$/)).not.toBeInTheDocument();
  });

  it('shows an em dash for a metric with no value rather than inventing one', () => {
    render(<HealthHeader name="Compound" slug="compound" kpis={[{ label: 'Gini', value: '—' }]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
