import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { SearchPage } from './search-page';

const push = vi.fn();
const replace = vi.fn();

let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn() }),
  useSearchParams: () => currentParams,
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

describe('SearchPage', () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    mockData = undefined;
    mockIsFetching = false;
    currentParams = new URLSearchParams();
    localStorage.clear();
  });

  it('renders search input pre-filled from initialQuery', () => {
    render(<SearchPage initialQuery="compound" />, { wrapper });
    expect(screen.getByDisplayValue('compound')).toBeInTheDocument();
  });

  it('displays grouped results with section headings', () => {
    setSearchData([PROPOSAL], [DAO], [ACTOR]);
    currentParams = new URLSearchParams({ q: 'test' });

    render(<SearchPage initialQuery="test" />, { wrapper });

    expect(screen.getByText('Add WBTC market')).toBeInTheDocument();
    expect(screen.getByText('Aave')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getAllByText('Proposals')).toHaveLength(2);
    expect(screen.getAllByText('DAOs')).toHaveLength(2);
    expect(screen.getAllByText('Actors')).toHaveLength(2);
  });

  it('type filter tabs show correct counts', () => {
    setSearchData([PROPOSAL], [DAO], [ACTOR]);
    currentParams = new URLSearchParams({ q: 'test' });

    render(<SearchPage initialQuery="test" />, { wrapper });

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveTextContent('All');
    expect(tabs[0]).toHaveTextContent('3');
    expect(tabs[1]).toHaveTextContent('Proposals');
    expect(tabs[1]).toHaveTextContent('1');
    expect(tabs[2]).toHaveTextContent('DAOs');
    expect(tabs[2]).toHaveTextContent('1');
    expect(tabs[3]).toHaveTextContent('Actors');
    expect(tabs[3]).toHaveTextContent('1');
  });

  it('clicking a type tab updates URL', async () => {
    setSearchData([PROPOSAL], [DAO]);
    currentParams = new URLSearchParams({ q: 'test' });
    const user = userEvent.setup();

    render(<SearchPage initialQuery="test" />, { wrapper });

    await user.click(screen.getByRole('tab', { name: /Proposals/ }));

    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining('type=proposal'),
      expect.anything(),
    );
  });

  it('shows recent searches when no query', () => {
    localStorage.setItem('kv:recent-searches', JSON.stringify(['compound', 'aave']));

    render(<SearchPage initialQuery="" />, { wrapper });

    expect(screen.getByText('Recent searches')).toBeInTheDocument();
    expect(screen.getByText('compound')).toBeInTheDocument();
    expect(screen.getByText('aave')).toBeInTheDocument();
  });

  it('shows guidance when no query and no recent searches', () => {
    render(<SearchPage initialQuery="" />, { wrapper });
    expect(screen.getByText(/Start typing to search/)).toBeInTheDocument();
  });

  it('shows no-results state with tips', () => {
    setSearchData();
    currentParams = new URLSearchParams({ q: 'nonexistent' });

    render(<SearchPage initialQuery="nonexistent" />, { wrapper });

    expect(screen.getByText(/No results for/)).toBeInTheDocument();
    expect(screen.getByText('Try different keywords')).toBeInTheDocument();
  });

  it('result links point to correct URLs', () => {
    setSearchData([PROPOSAL], [DAO], [ACTOR]);
    currentParams = new URLSearchParams({ q: 'test' });

    render(<SearchPage initialQuery="test" />, { wrapper });

    const proposalLink = screen.getByText('Add WBTC market').closest('a');
    expect(proposalLink).toHaveAttribute(
      'href',
      '/daos/compound/proposals/compound_governor_bravo/42',
    );

    const daoLink = screen.getByText('Aave').closest('a');
    expect(daoLink).toHaveAttribute('href', '/daos/aave');

    const actorLink = screen.getByText('Alice').closest('a');
    expect(actorLink).toHaveAttribute('href', `/actors/${ACTOR.primary_address}`);
  });

  it('updates input value and triggers debounced URL update on typing', async () => {
    const user = userEvent.setup();

    render(<SearchPage initialQuery="" />, { wrapper });

    const input = screen.getByPlaceholderText(/Search proposals/);
    await user.type(input, 'aave');

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(expect.stringContaining('q=aave'), expect.anything());
    }, WAIT_OPTS);
  });
});
