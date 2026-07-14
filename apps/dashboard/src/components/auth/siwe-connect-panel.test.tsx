import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { WagmiProvider } from 'wagmi';

import { SiweConnectPanel } from './siwe-connect-panel';
import { wagmiConfig } from '../../lib/wallet/config';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/login',
}));

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  // Seed a signed-out session so the panel doesn't redirect or fetch.
  client.setQueryData(['auth', 'session'], null);
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <SiweConnectPanel mode="login" next="/developer" />
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

describe('SiweConnectPanel', () => {
  it('toggles between the wallet and (stubbed) email methods', () => {
    renderPanel();

    // Wallet is the default method.
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();

    // Switching to email reveals the coming-soon stub with disabled inputs.
    fireEvent.click(screen.getByRole('button', { name: 'Continue with email' }));
    expect(screen.getByText(/Email accounts are coming soon/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Connect wallet' })).not.toBeInTheDocument();

    // And back to wallet.
    fireEvent.click(screen.getByRole('button', { name: /Sign in with your wallet instead/ }));
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
  });
});
