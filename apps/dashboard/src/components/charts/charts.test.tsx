import { fireEvent, render, screen, within } from '@testing-library/react';

import { DelegationFlow } from './delegation-flow';
import { Heatmap } from './heatmap';
import { Sparkline } from './sparkline';
import { StackedArea } from './stacked-area';
import { TimeSeries } from './time-series';

describe('Figure contract (via TimeSeries)', () => {
  function renderChart() {
    return render(
      <TimeSeries
        title="Participation"
        buckets={['Jan', 'Feb', 'Mar']}
        series={[{ label: 'Compound', values: [10, 20, 30] }]}
        formatValue={(v) => `${v}%`}
      />,
    );
  }

  it('shows the chart as a labelled image by default, with a table toggle', () => {
    renderChart();
    expect(screen.getByRole('img', { name: 'Participation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View as table' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('swaps to the data table on toggle (§6.19 accessible alternative)', () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Compound')).toBeInTheDocument();
    expect(within(table).getByText('20%')).toBeInTheDocument();
    // Toggle is reversible.
    expect(screen.getByRole('button', { name: 'View as chart' })).toBeInTheDocument();
  });
});

describe('StackedArea', () => {
  it('exposes a totals column in its table view', () => {
    render(
      <StackedArea
        title="Votes"
        buckets={['Jan']}
        series={[
          { label: 'For', values: [3] },
          { label: 'Against', values: [2] },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Total')).toBeInTheDocument();
    expect(within(table).getByText('5')).toBeInTheDocument(); // 3 + 2
  });
});

describe('Heatmap', () => {
  it('renders cells and a matrix table with a no-data marker', () => {
    render(
      <Heatmap
        title="Alignment"
        rowLabels={['a16z']}
        colLabels={['P-1', 'P-2']}
        cells={[[1, null]]}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />,
    );
    expect(screen.getByRole('img', { name: 'Alignment' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('100%')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument(); // null cell
  });
});

describe('DelegationFlow', () => {
  it('lists edges as delegator → delegate rows in its table', () => {
    render(
      <DelegationFlow
        title="Flow"
        nodes={[
          { id: 'a', label: 'holder.eth' },
          { id: 'x', label: 'Gauntlet' },
        ]}
        edges={[{ from: 'a', to: 'x', weight: 1000 }]}
        formatWeight={(w) => `${w}`}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('holder.eth')).toBeInTheDocument();
    expect(within(table).getByText('Gauntlet')).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('renders an accessible inline trend', () => {
    render(<Sparkline values={[1, 2, 3]} label="trend, latest 3" />);
    expect(screen.getByRole('img', { name: 'trend, latest 3' })).toBeInTheDocument();
  });
  it('renders nothing with no data', () => {
    const { container } = render(<Sparkline values={[]} label="empty" />);
    expect(container).toBeEmptyDOMElement();
  });
});
