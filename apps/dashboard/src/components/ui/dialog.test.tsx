import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog';

describe('Dialog', () => {
  it('opens on trigger click and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Connect wallet</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText('Connect wallet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Connect wallet')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Connect wallet')).not.toBeInTheDocument();
  });
});
