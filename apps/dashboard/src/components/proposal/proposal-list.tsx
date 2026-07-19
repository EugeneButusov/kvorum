'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ProposalCard } from './proposal-card';
import { ProposalFilters } from './proposal-filters';
import { daoVariant, stateToVariant } from './state';
import { TallySummary } from './tally-summary';
import { Pill } from '@/components/ui/pill';
import { StatePill } from '@/components/ui/state-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { browserApi } from '@/lib/api/client';
import { formatDateTime, formatDeadline, truncateAddress } from '@/lib/format';
import {
  fetchProposalPage,
  PAGE_SIZE,
  toSearchParams,
  type ProposalFilters as Filters,
  type ProposalListItemView,
  type ProposalPage,
  type ProposalSort,
} from '@/lib/proposals/list';
import { sourceLabel } from '@/lib/proposals/source';
import { cn } from '@/lib/utils';

export type ProposalListProps = {
  scope: 'cross' | 'dao';
  slug?: string;
  initialFilters: Filters;
  initialSort: ProposalSort;
  initialPage: ProposalPage;
  daoOptions?: { slug: string; name: string }[];
};

/**
 * The shared filterable/sortable proposals list (§6.5 cross-DAO, §6.8 DAO-scoped). A dense table
 * (ID · Proposal · DAO · State · Tally · Ends) under a horizontal filter strip, one page at a time
 * with a pager beneath it. Filter + sort state lives in React and is mirrored into the URL
 * (shareable); SSR seeds the first page. Sorting is driven by the Ends / closed header, as in the
 * reference — there is no separate sort control.
 */
export function ProposalList({
  scope,
  slug,
  initialFilters,
  initialSort,
  initialPage,
  daoOptions = [],
}: ProposalListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<ProposalSort>(initialSort);
  // Cursor pagination only walks forward, so remember the cursor that opened each page to step back.
  // Index 0 is the unparameterised first page; the entry at pageIndex opens the page being shown.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);

  // Mirror state into the URL without scrolling or adding history entries.
  useEffect(() => {
    const qs = toSearchParams(filters, sort).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, sort, pathname, router]);

  const resetToFirstPage = () => {
    setCursors([undefined]);
    setPageIndex(0);
  };
  const changeFilters = (next: Filters) => {
    setFilters(next);
    resetToFirstPage();
  };
  const changeSort = (next: ProposalSort) => {
    setSort(next);
    resetToFirstPage();
  };

  const cursor = cursors[pageIndex];
  const isInitial =
    filters === initialFilters &&
    sort.field === initialSort.field &&
    sort.dir === initialSort.dir &&
    pageIndex === 0;

  const query = useQuery({
    queryKey: ['proposals', scope, slug, filters, sort, pageIndex],
    queryFn: () => fetchProposalPage(browserApi, { slug, filters, sort, cursor }),
    initialData: isInitial ? initialPage : undefined,
    // Keep the previous page on screen while the next one loads, so the table doesn't blank out.
    placeholderData: keepPreviousData,
  });

  const page: ProposalPage = query.data ?? { items: [], nextCursor: null };
  const items = page.items;
  const showDao = scope === 'cross';
  const firstOnPage = pageIndex * PAGE_SIZE + 1;

  const goNext = () => {
    if (page.nextCursor == null) return;
    setCursors((prev) => {
      const next = [...prev];
      next[pageIndex + 1] = page.nextCursor ?? undefined;
      return next;
    });
    setPageIndex((i) => i + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <ProposalFilters
        scope={scope}
        filters={filters}
        onChange={changeFilters}
        daoOptions={daoOptions}
      />

      {query.isError ? (
        <p className="border border-line-3 bg-bg-2 py-10 text-center font-mono text-mono-body text-ink-3">
          Failed to load proposals.
        </p>
      ) : items.length === 0 && !query.isFetching ? (
        <p className="border border-line-3 bg-bg-2 py-10 text-center font-mono text-mono-body text-ink-3">
          No proposals match these filters.
        </p>
      ) : (
        <div className="md:border md:border-line-3 md:bg-bg-2">
          {/* Phone: the table's columns cannot fit at 390px, so the same rows stack as cards. The
              Ends header doubles as the sort control on desktop, so the card list needs its own. */}
          <div className="md:hidden">
            <div className="flex items-baseline justify-between border-b border-line-3 px-0.5 pb-1.5 font-mono text-caption uppercase tracking-[0.06em] text-ink-3">
              <span className="font-semibold text-ink">Proposals</span>
              <SortEndsButton sort={sort} onChange={changeSort} />
            </div>
            <div className="flex flex-col gap-2.5 pt-2.5">
              {items.map((item) => (
                <ProposalCard
                  key={`${item.daoSlug}:${item.sourceType}:${item.sourceId}`}
                  item={item}
                  showDao={showDao}
                />
              ))}
            </div>
          </div>

          <Table className="hidden md:table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20 bg-bg">ID</TableHead>
                <TableHead className="bg-bg">Proposal</TableHead>
                {showDao && <TableHead className="w-28 bg-bg">DAO</TableHead>}
                <TableHead className="w-24 bg-bg">State</TableHead>
                <TableHead className="w-[240px] bg-bg">Tally</TableHead>
                <SortableEndsHead sort={sort} onChange={changeSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <ProposalTableRow
                  key={`${item.daoSlug}:${item.sourceType}:${item.sourceId}`}
                  item={item}
                  showDao={showDao}
                />
              ))}
            </TableBody>
          </Table>

          <div className="mt-2.5 flex items-center justify-between border border-line-3 bg-bg-2 px-3.5 py-2.5 font-mono text-small text-ink-3 md:mt-0 md:border-x-0 md:border-b-0">
            {/* No total: the list API pages by cursor and returns no count, so the reference's
                "of 2,418" and numbered pages can't be shown honestly. */}
            <span>
              {items.length > 0
                ? `Showing ${firstOnPage}–${firstOnPage + items.length - 1}`
                : 'No results'}
            </span>
            <div className="flex items-center gap-1">
              <PagerButton onClick={() => setPageIndex((i) => i - 1)} disabled={pageIndex === 0}>
                ← prev
              </PagerButton>
              <PagerButton onClick={goNext} disabled={page.nextCursor == null}>
                next →
              </PagerButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProposalTableRow({ item, showDao }: { item: ProposalListItemView; showDao: boolean }) {
  const deadline = formatDeadline(item.votingEndsAt);
  const absolute = item.votingEndsAt ? formatDateTime(item.votingEndsAt) : null;
  const live = item.state === 'active';
  const idLabel = /^\d+$/.test(item.sourceId) ? `#${item.sourceId}` : item.sourceId;
  const proposerName = item.proposer.displayName ?? truncateAddress(item.proposer.address);

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap align-top text-ink-3">{idLabel}</TableCell>
      <TableCell className="align-top">
        <Link
          href={item.href}
          className="line-clamp-2 font-sans text-body-lg font-medium text-ink hover:text-primary"
        >
          {item.title ?? `Proposal #${item.sourceId}`}
        </Link>
        <div className="mt-1 text-caption text-ink-3">
          proposer {proposerName} · {sourceLabel(item.sourceType)}
          {!item.binding && ' · signaling'}
        </div>
      </TableCell>
      {showDao && (
        <TableCell className="align-top">
          <Pill dao={daoVariant(item.daoSlug)}>{item.daoSlug}</Pill>
        </TableCell>
      )}
      <TableCell className="align-top">
        <StatePill state={stateToVariant(item.state)}>{item.state}</StatePill>
      </TableCell>
      <TableCell className="align-top">
        <TallySummary bars={item.tally} />
      </TableCell>
      <TableCell className="whitespace-nowrap align-top">
        <div className="flex flex-col" suppressHydrationWarning>
          <span className={live ? 'text-primary' : 'text-ink-3'}>{deadline ?? '—'}</span>
          {absolute && <span className="text-ink-4">{absolute}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * The Ends / closed header doubles as the sort control (reference `.arr`): clicking it sorts by
 * voting close, and clicking again flips the direction. Other sort fields remain reachable by URL.
 */
function SortableEndsHead({
  sort,
  onChange,
}: {
  sort: ProposalSort;
  onChange: (s: ProposalSort) => void;
}) {
  const { active, dir } = readEndsSort(sort);

  return (
    <TableHead className="w-40 bg-bg p-0">
      <button
        type="button"
        onClick={() => onChange(nextEndsSort(sort))}
        aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
        className="flex h-9 w-full items-center gap-1 px-3 text-left uppercase tracking-[0.04em] hover:text-ink"
      >
        Ends / closed
        <span aria-hidden className={cn(active ? 'text-ink-3' : 'text-ink-4')}>
          {dir === 'desc' ? '↓' : '↑'}
        </span>
      </button>
    </TableHead>
  );
}

/**
 * The phone-width stand-in for the sortable Ends header, in the reference's `.m-section-h .r` slot.
 * It shares {@link nextEndsSort} with the header so the two cannot disagree about what a click does.
 */
function SortEndsButton({
  sort,
  onChange,
}: {
  sort: ProposalSort;
  onChange: (s: ProposalSort) => void;
}) {
  const { active, dir } = readEndsSort(sort);

  return (
    <button
      type="button"
      onClick={() => onChange(nextEndsSort(sort))}
      aria-label={`Sort by end time, ${dir === 'desc' ? 'latest' : 'earliest'} first`}
      className="flex items-center gap-1 uppercase tracking-[0.06em] hover:text-ink"
    >
      ends
      <span aria-hidden className={cn(active ? 'text-ink-3' : 'text-ink-4')}>
        {dir === 'desc' ? '↓' : '↑'}
      </span>
    </button>
  );
}

function readEndsSort(sort: ProposalSort): { active: boolean; dir: 'asc' | 'desc' } {
  const active = sort.field === 'voting_ends_at';
  return { active, dir: active ? sort.dir : 'desc' };
}

function nextEndsSort(sort: ProposalSort): ProposalSort {
  const { active, dir } = readEndsSort(sort);
  return { field: 'voting_ends_at', dir: active && dir === 'desc' ? 'asc' : 'desc' };
}

function PagerButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'border border-line-2 px-3 py-1 font-mono text-pill transition-colors',
        disabled ? 'cursor-default text-ink-4' : 'text-ink-2 hover:border-line hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
