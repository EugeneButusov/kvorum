import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { CommandPalette } from './command-palette';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, prefetch: vi.fn() }),
}));

let mockData: Record<string, unknown> | undefined;
let mockIsFetching = false;

vi.mock('./use-search', () => ({
  useSearch: () => ({ data: mockData, isFetching: mockIsFetching }),
}));

function setSearchData(
  proposals: Record<string, unknown>[] = [],
  daos: Record<string, unknown>[] = [],
  actors: Record<string, unknown>[] = [],
) {
  mockData = { data: { proposals, daos, actors } };
}

const PROPOSAL = {
  dao_slug: 'compound',
  dao_name: 'Compound',
  source_type: 'compound_governor_bravo',
  source_id: '42',
  title: 'Add WBTC market',
  state: 'active',
  voting_starts_at: null,
  rank: 0.8,
};

const DAO = { slug: 'aave', name: 'Aave', description: 'Aave governance', rank: 0.9 };

const ACTOR = {
  display_name: 'Alice',
  primary_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  rank: 1.0,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const WAIT_OPTS = { timeout: 3000 };

describe('CommandPalette', () => {
  beforeEach(() => {
    push.mockReset();
    mockData = undefined;
    mockIsFetching = false;
    localStorage.clear();
  });

  it('renders input with placeholder when open', () => {
    render(<CommandPalette open={true} onOpenChange={vi.fn()} />, { wrapper });
    expect(screen.getByPlaceholderText(/Search proposals/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<CommandPalette open={false} onOpenChange={vi.fn()} />, { wrapper });
    expect(screen.queryByPlaceholderText(/Search proposals/)).not.toBeInTheDocument();
  });

  it('displays categorized results after typing', async () => {
    setSearchData([PROPOSAL], [DAO], [ACTOR]);
    const user = userEvent.setup();

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />, { wrapper });

    await user.type(screen.getByRole('combobox'), 'compound');

    await waitFor(() => {
      expect(screen.getByText('Proposals')).toBeInTheDocument();
    }, WAIT_OPTS);
    expect(screen.getByText('Add WBTC market')).toBeInTheDocument();
    expect(screen.getByText('DAOs')).toBeInTheDocument();
    expect(screen.getByText('Aave')).toBeInTheDocument();
    expect(screen.getByText('Actors')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('navigates on Enter and closes palette', async () => {
    setSearchData([PROPOSAL]);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<CommandPalette open={true} onOpenChange={onOpenChange} />, { wrapper });

    await user.type(screen.getByRole('combobox'), 'compound');

    await waitFor(() => {
      expect(screen.getByText('Add WBTC market')).toBeInTheDocument();
    }, WAIT_OPTS);

    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/daos/compound/proposals/compound_governor_bravo/42');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows empty state for no results', async () => {
    setSearchData();
    const user = userEvent.setup();

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />, { wrapper });

    await user.type(screen.getByRole('combobox'), 'nonexistent');

    await waitFor(() => {
      expect(screen.getByText(/No results for/)).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('arrow keys move selection', async () => {
    setSearchData([PROPOSAL], [DAO]);
    const user = userEvent.setup();

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />, { wrapper });

    await user.type(screen.getByRole('combobox'), 'test');

    await waitFor(() => {
      expect(screen.getByText('Add WBTC market')).toBeInTheDocument();
    }, WAIT_OPTS);

    const firstOption = screen.getByText('Add WBTC market').closest('[role="option"]');
    expect(firstOption).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');

    const secondOption = screen.getByText('Aave').closest('[role="option"]');
    expect(secondOption).toHaveAttribute('aria-selected', 'true');
  });

  it('shows recent searches when input is empty', () => {
    localStorage.setItem('kv:recent-searches', JSON.stringify(['compound', 'aave']));

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />, { wrapper });

    expect(screen.getByText('Recent searches')).toBeInTheDocument();
    expect(screen.getByText('compound')).toBeInTheDocument();
    expect(screen.getByText('aave')).toBeInTheDocument();
  });

  it('shows start-typing prompt when no recent searches', () => {
    render(<CommandPalette open={true} onOpenChange={vi.fn()} />, { wrapper });
    expect(screen.getByText(/Start typing to search/)).toBeInTheDocument();
  });
});
