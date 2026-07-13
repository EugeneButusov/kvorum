import { render, screen } from '@testing-library/react';

import { GovernanceTracks } from './governance-tracks';

describe('GovernanceTracks', () => {
  it('surfaces each Lido track explicitly with no unified power figure (§6.17)', () => {
    render(<GovernanceTracks sourceTypes={['aragon_voting', 'snapshot', 'dual_governance']} />);
    expect(screen.getByText('Aragon voting')).toBeInTheDocument();
    expect(screen.getByText('Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Dual governance')).toBeInTheDocument();
    expect(screen.getByText(/no single .*voting power.* figure/i)).toBeInTheDocument();
  });

  it('renders nothing for a single-source DAO', () => {
    const { container } = render(<GovernanceTracks sourceTypes={['compound_governor_bravo']} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dedupes repeated source types', () => {
    render(<GovernanceTracks sourceTypes={['aragon_voting', 'aragon_voting', 'snapshot']} />);
    expect(screen.getAllByText('Aragon voting')).toHaveLength(1);
  });
});
