import { render, screen } from '@testing-library/react';

import { TreasurySection } from './treasury-section';

describe('TreasurySection', () => {
  it('renders the section heading and placeholder text', () => {
    render(<TreasurySection />);
    expect(screen.getByText('Treasury composition')).toBeInTheDocument();
    expect(screen.getByText(/arriving in a later milestone/)).toBeInTheDocument();
  });
});
