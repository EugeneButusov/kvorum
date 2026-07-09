import { render, screen } from '@testing-library/react';

import { Power } from './power';

describe('Power', () => {
  it('renders the compact value, unit, and reference block', () => {
    render(<Power value={1_234_567} unit="COMP" referenceBlock={21_000_000} />);
    expect(screen.getByText('1.2M COMP')).toBeInTheDocument();
    expect(screen.getByText(/as of block 21,000,000/)).toBeInTheDocument();
  });
});
