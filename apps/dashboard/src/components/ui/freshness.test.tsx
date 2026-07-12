import { render, screen } from '@testing-library/react';

import { Freshness } from './freshness';

const NOW = Date.now();

describe('Freshness', () => {
  it('renders nothing for settled (non-active) data', () => {
    const { container } = render(<Freshness active={false} updatedAt={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a live "updated N ago" status while polling', () => {
    render(<Freshness active updatedAt={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Updated/);
  });

  it('shows a retrying state on error', () => {
    render(<Freshness active updatedAt={NOW} isError />);
    expect(screen.getByRole('status')).toHaveTextContent(/retrying/);
  });

  it('shows an explicit paused message when quota runs out', () => {
    render(<Freshness active updatedAt={NOW} isPaused />);
    expect(screen.getByRole('status')).toHaveTextContent(/Live updates paused/);
  });

  it('prefers the paused message over retrying', () => {
    render(<Freshness active updatedAt={NOW} isError isPaused />);
    expect(screen.getByRole('status')).toHaveTextContent(/Live updates paused/);
    expect(screen.queryByText(/retrying/)).not.toBeInTheDocument();
  });
});
