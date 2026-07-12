import { render, screen } from '@testing-library/react';

import { DaoHealthCards } from './dao-health-cards';

describe('DaoHealthCards', () => {
  it('renders one card per DAO linking to its health dashboard', () => {
    render(
      <DaoHealthCards
        daos={[
          { slug: 'lido', name: 'Lido' },
          { slug: 'aave', name: 'Aave' },
        ]}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(screen.getByText('Lido').closest('a')).toHaveAttribute('href', '/daos/lido/health');
  });

  it('renders nothing when there are no DAOs', () => {
    const { container } = render(<DaoHealthCards daos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
