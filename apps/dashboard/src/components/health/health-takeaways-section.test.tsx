import { render, screen } from '@testing-library/react';

import { HealthTakeawaysSection } from './health-takeaways-section';

describe('HealthTakeawaysSection', () => {
  it('renders the section heading and coming-soon AI panel', () => {
    render(<HealthTakeawaysSection slug="compound" />);
    expect(screen.getByText('Health takeaways')).toBeInTheDocument();
    expect(screen.getByText(/Health synthesis/)).toBeInTheDocument();
  });

  it('links to proposals as the fallback', () => {
    render(<HealthTakeawaysSection slug="compound" />);
    const link = screen.getByRole('link', { name: /View recent proposals/ });
    expect(link).toHaveAttribute('href', '/daos/compound/proposals');
  });
});
