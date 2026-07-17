import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ProposalList } from './proposal-list';
import { DEFAULT_SORT, EMPTY_FILTERS, type ProposalListItemView } from '../../lib/proposals/list';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/proposals',
}));
vi.mock('@/lib/api/client', () => ({ browserApi: { GET: vi.fn() } }));

// jsdom has no IntersectionObserver (used for infinite scroll).
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function item(id: string, title: string): ProposalListItemView {
  return {
    daoSlug: 'lido',
    sourceType: 'snapshot',
    sourceId: id,
    title,
    state: 'active',
    binding: true,
    votingStartsAt: null,
    votingEndsAt: null,
    proposer: { address: '0xabc', displayName: null },
    tally: [
      { kind: 'for', pct: 75 },
      { kind: 'against', pct: 25 },
    ],
    href: `/daos/lido/proposals/snapshot/${id}`,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderList(items: ProposalListItemView[]) {
  return render(
    <ProposalList
      scope="cross"
      initialFilters={EMPTY_FILTERS}
      initialSort={DEFAULT_SORT}
      initialPage={{ items, nextCursor: null }}
      daoOptions={[{ slug: 'lido', name: 'Lido' }]}
    />,
    { wrapper },
  );
}

describe('ProposalList', () => {
  beforeEach(() => replace.mockClear());

  it('renders the SSR-seeded rows and the sort control', () => {
    renderList([item('1', 'First'), item('2', 'Second')]);
    expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sort')).toBeInTheDocument();
    expect(screen.getByText('2 loaded')).toBeInTheDocument();
  });

  it('mirrors a filter change into the URL (shareable)', async () => {
    renderList([item('1', 'First')]);
    // 'pending' isn't in the default state set → toggling it writes a state= param.
    fireEvent.click(screen.getByRole('button', { name: 'pending' }));
    await waitFor(() => {
      const last = replace.mock.calls.at(-1)?.[0] as string;
      expect(last).toMatch(/state=/);
      expect(last).toContain('pending');
    });
  });

  it('mirrors a sort change into the URL', async () => {
    renderList([item('1', 'First')]);
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'created_at' } });
    await waitFor(() => {
      expect(replace.mock.calls.at(-1)?.[0] as string).toContain('sort=-created_at');
    });
  });

  it('shows an empty state when nothing matches', () => {
    renderList([]);
    expect(screen.getByText(/No proposals match/)).toBeInTheDocument();
  });
});
