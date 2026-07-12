import { render, screen } from '@testing-library/react';

import { StatsBar } from './stats-bar';

describe('StatsBar', () => {
  it('renders the tagline and the DAO count', () => {
    render(<StatsBar daoCount={7} />);
    expect(
      screen.getByRole('heading', { name: /Governance intelligence for DeFi DAOs/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('DAOs tracked')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
