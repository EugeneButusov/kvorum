import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { WagmiProvider } from 'wagmi';

import { ApiKeysSection } from './api-keys-section';
import { DeveloperDashboard } from './developer-dashboard';
import { KeyStatusBadge } from './key-status-badge';
import { wagmiConfig } from '../../lib/wallet/config';
import type { ApiKey } from '@/lib/developer/keys';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/developer',
}));

const KEY: ApiKey = {
  id: 'k1',
  prefix: 'kv_live_ab',
  last_four: 'Z9Q2',
  label: 'production',
  created_at: '2026-06-01T00:00:00Z',
  last_used_at: null,
  status: 'active',
};

function renderWithClient(ui: React.ReactNode, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  seed?.(client);
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </WagmiProvider>,
  );
}

describe('KeyStatusBadge', () => {
  it('labels each status', () => {
    const { rerender } = render(<KeyStatusBadge status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    rerender(<KeyStatusBadge status="expiring" />);
    expect(screen.getByText('Rotating')).toBeInTheDocument();
    rerender(<KeyStatusBadge status="revoked" />);
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });
});

describe('DeveloperDashboard', () => {
  beforeEach(() => replace.mockClear());

  it('redirects to login with a return URL when there is no session', () => {
    renderWithClient(<DeveloperDashboard />, (client) => {
      client.setQueryData(['auth', 'session'], null);
    });
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fdeveloper');
  });

  it('renders the sections when signed in', () => {
    renderWithClient(<DeveloperDashboard />, (client) => {
      client.setQueryData(['auth', 'session'], { userId: 'u1', address: '0xabc' });
      client.setQueryData(['developer', 'keys'], []);
    });
    expect(screen.getByRole('heading', { name: /API keys/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Account/ })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('ApiKeysSection', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(
      async () => new Response('{"data":[]}', { status: 200 }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('renders seeded keys with the masked identifier and actions', () => {
    renderWithClient(<ApiKeysSection />, (client) => {
      client.setQueryData(['developer', 'keys'], [KEY]);
    });
    expect(screen.getByText('kv_live_ab…Z9Q2')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New key/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no keys', () => {
    renderWithClient(<ApiKeysSection />, (client) => {
      client.setQueryData(['developer', 'keys'], []);
    });
    expect(screen.getByText(/No API keys yet/)).toBeInTheDocument();
  });
});
