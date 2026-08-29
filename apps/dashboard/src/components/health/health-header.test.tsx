import { render, screen } from '@testing-library/react';

import { HealthHeader, type HealthKpi } from './health-header';

const kpis: HealthKpi[] = [
  { label: 'Pass rate (90d)', value: '71%' },
  { label: 'Participation', value: '—' },
  { label: 'Top-10 VP', value: '42.7%', deltaPp: 3.2, higherIsWorse: true },
  { label: 'Open flags', value: '—' },
];

const baseProps = {
  name: 'Compound',
  slug: 'compound',
  contractAddress: '0xc0da…7c2',
  governorLabel: 'Governor Bravo',
  forumUrl: 'https://forum.compound.finance',
  kpis,
};

describe('HealthHeader', () => {
  it('renders the DAO name as the heading', () => {
    render(<HealthHeader {...baseProps} />);
    expect(screen.getByRole('heading', { name: 'Compound' })).toBeInTheDocument();
  });

  it('shows operator framing text', () => {
    render(<HealthHeader {...baseProps} />);
    expect(screen.getByText(/Stewarding Compound\?/)).toBeInTheDocument();
  });

  it('shows the contract address and governor label', () => {
    render(<HealthHeader {...baseProps} />);
    expect(screen.getByText('0xc0da…7c2')).toBeInTheDocument();
    expect(screen.getByText('governor bravo')).toBeInTheDocument();
  });

  it('links to the DAO surfaces an operator jumps to next', () => {
    render(<HealthHeader {...baseProps} />);
    expect(screen.getByRole('link', { name: 'View proposals →' })).toHaveAttribute(
      'href',
      '/daos/compound/proposals',
    );
    expect(screen.getByRole('link', { name: 'Top delegates →' })).toHaveAttribute(
      'href',
      '/daos/compound/delegates',
    );
    expect(screen.getByRole('link', { name: 'Forum threads →' })).toHaveAttribute(
      'href',
      'https://forum.compound.finance',
    );
  });

  it('hides the forum link when no forum URL is provided', () => {
    render(<HealthHeader {...baseProps} forumUrl={null} />);
    expect(screen.queryByRole('link', { name: 'Forum threads →' })).not.toBeInTheDocument();
  });

  it('renders each headline metric', () => {
    render(<HealthHeader {...baseProps} />);
    expect(screen.getByText('Pass rate (90d)')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('Participation')).toBeInTheDocument();
    expect(screen.getByText('Open flags')).toBeInTheDocument();
  });

  it('marks a rise in concentration as a concern, not an improvement', () => {
    render(<HealthHeader {...baseProps} />);
    const delta = screen.getByText(/3\.2pp/);
    expect(delta).toHaveTextContent('↑');
    expect(delta.className).toContain('text-warn');
  });

  it('treats a falling concentration as an improvement', () => {
    render(
      <HealthHeader
        {...baseProps}
        kpis={[{ label: 'Top-10 VP', value: '40%', deltaPp: -2, higherIsWorse: true }]}
      />,
    );
    const delta = screen.getByText(/2\.0pp/);
    expect(delta).toHaveTextContent('↓');
    expect(delta.className).toContain('text-primary');
  });

  it('omits the delta when there is not enough history to compute one', () => {
    render(
      <HealthHeader {...baseProps} kpis={[{ label: 'Top-10 VP', value: '40%', deltaPp: null }]} />,
    );
    expect(screen.queryByText(/pp$/)).not.toBeInTheDocument();
  });

  it('shows an em dash for a metric with no value rather than inventing one', () => {
    render(<HealthHeader {...baseProps} kpis={[{ label: 'Gini', value: '—' }]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
