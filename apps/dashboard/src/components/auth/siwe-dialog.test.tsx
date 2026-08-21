import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { SiweDialog } from './siwe-dialog';

const wallet = vi.hoisted(() => ({
  connect: vi.fn(),
  runSiweLogin: vi.fn(),
  isConnected: false,
  chainId: undefined as number | undefined,
}));

// The handshake itself is out of scope here and would otherwise reach the network: once the wallet
// is connected on the auth chain the flow signs automatically.
vi.mock('../../lib/auth/siwe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/auth/siwe')>()),
  runSiweLogin: wallet.runSiweLogin,
}));

// Partial: lib/wallet/config.ts builds the real wagmiConfig with `createConfig`, so only the
// hooks the flow consumes are replaced.
vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({
    address: wallet.isConnected ? '0x1111111111111111111111111111111111111111' : undefined,
    isConnected: wallet.isConnected,
    chainId: wallet.chainId,
  }),
  useConnect: () => ({
    connect: wallet.connect,
    connectors: [{ id: 'injected', name: 'Injected' }],
    isPending: false,
  }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));

function renderDialog(open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SiweDialog open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  wallet.connect.mockReset();
  wallet.runSiweLogin.mockReset().mockResolvedValue(undefined);
  wallet.isConnected = false;
  wallet.chainId = undefined;
});

describe('SiweDialog', () => {
  it('opens the wallet itself instead of asking a second time', () => {
    renderDialog();

    expect(wallet.connect).toHaveBeenCalledTimes(1);
    // The redundant step this replaced: a modal whose only content was another connect button.
    expect(screen.queryByRole('button', { name: /^Connect wallet$/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Check your wallet/)).toBeInTheDocument();
  });

  it('asks the wallet once per opening, not once per render', () => {
    const { rerender } = renderDialog();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SiweDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(wallet.connect).toHaveBeenCalledTimes(1);
  });

  it('does not touch the wallet while closed', () => {
    renderDialog(false);
    expect(wallet.connect).not.toHaveBeenCalled();
  });

  it('surfaces a dismissed prompt as a cancellation the user can retry', () => {
    // Connecting on open makes a rejection reachable with no button behind it — the flow must land
    // somewhere recoverable rather than re-prompting, which would be a loop with no way out.
    wallet.connect.mockImplementation((_args, opts) => {
      opts?.onError?.(Object.assign(new Error('...'), { name: 'UserRejectedRequestError' }));
    });

    renderDialog();

    expect(screen.getByText('Connection cancelled.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(wallet.connect).toHaveBeenCalledTimes(1);
  });

  it('skips connecting and signs when the wallet is already on the auth chain', async () => {
    wallet.isConnected = true;
    wallet.chainId = 1;

    renderDialog();

    await waitFor(() => expect(wallet.runSiweLogin).toHaveBeenCalledTimes(1));
    expect(wallet.connect).not.toHaveBeenCalled();
  });

  it('offers the network switch instead of connecting when on the wrong chain', () => {
    wallet.isConnected = true;
    wallet.chainId = 8453;

    renderDialog();

    expect(wallet.connect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Switch to/ })).toBeInTheDocument();
  });
});
