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

  it('renders the SSR-seeded rows', () => {
    renderList([item('1', 'First'), item('2', 'Second')]);
    expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Second' })).toBeInTheDocument();
  });

  it('offers no separate sort control and no loaded counter', () => {
    renderList([item('1', 'First'), item('2', 'Second')]);
    // Sorting lives on the Ends / closed header now; the row count was noise.
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ loaded/)).not.toBeInTheDocument();
  });

  it('pages rather than scrolling infinitely', () => {
    renderList([item('1', 'First')]);
    expect(screen.getByRole('button', { name: /prev/ })).toBeDisabled();
    // Seeded page reports no next cursor, so there is nothing to advance to.
    expect(screen.getByRole('button', { name: /next/ })).toBeDisabled();
    expect(screen.getByText('Showing 1–1')).toBeInTheDocument();
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

  it('sorts by clicking the Ends / closed header, flipping direction on a second click', async () => {
    renderList([item('1', 'First')]);
    const header = screen.getByRole('button', { name: /Ends \/ closed/ });

    // Default is -voting_ends_at, so the first click flips to ascending.
    fireEvent.click(header);
    await waitFor(() => {
      expect(replace.mock.calls.at(-1)?.[0] as string).toContain('sort=voting_ends_at');
    });

    // Clicking back to descending is the default sort, which is omitted to keep URLs clean.
    fireEvent.click(header);
    await waitFor(() => {
      expect(replace.mock.calls.at(-1)?.[0] as string).not.toContain('sort=');
    });
  });

  it('marks the sorted header for assistive tech', () => {
    renderList([item('1', 'First')]);
    expect(screen.getByRole('button', { name: /Ends \/ closed/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('renders every proposal in both the phone card list and the desktop table', () => {
    // Which one is visible is a CSS media query, so both are in the DOM. They must agree on the
    // rows, otherwise a phone and a laptop would show different lists.
    renderList([item('1', 'First'), item('2', 'Second')]);

    for (const href of ['/daos/lido/proposals/snapshot/1', '/daos/lido/proposals/snapshot/2']) {
      expect(
        screen.getAllByRole('link').filter((l) => l.getAttribute('href') === href),
      ).toHaveLength(2);
    }
  });

  it('gives the phone card list its own sort control, driving the same sort as the header', async () => {
    // The Ends / closed header is a table header, so it is hidden at phone width — without this
    // control there would be no way to change the sort on a phone.
    renderList([item('1', 'First')]);

    fireEvent.click(screen.getByRole('button', { name: /Sort by end time/ }));
    await waitFor(() => {
      expect(replace.mock.calls.at(-1)?.[0] as string).toContain('sort=voting_ends_at');
    });
  });

  it('shows an empty state when nothing matches', () => {
    renderList([]);
    expect(screen.getByText(/No proposals match/)).toBeInTheDocument();
  });
});
