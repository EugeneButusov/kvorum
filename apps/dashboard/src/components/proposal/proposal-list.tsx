'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  SORT_FIELDS,
  SORT_LABELS,
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
 * (ID · Proposal · DAO · State · Ends) under a horizontal filter strip. Filter + sort state lives in
 * React and is mirrored into the URL (shareable), driving a cursor-paged infinite query; SSR seeds
 * the first page. Per-row tally bars, AI snippets, and mismatch flags from the reference need data the
 * list API doesn't carry (batched tally endpoint / M5) and land with those.
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

  // Mirror state into the URL without scrolling or adding history entries.
  useEffect(() => {
    const qs = toSearchParams(filters, sort).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, sort, pathname, router]);

  const isInitial =
    filters === initialFilters && sort.field === initialSort.field && sort.dir === initialSort.dir;

  const query = useInfiniteQuery({
    queryKey: ['proposals', scope, slug, filters, sort],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchProposalPage(browserApi, { slug, filters, sort, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ProposalPage) => last.nextCursor ?? undefined,
    initialData: isInitial
      ? { pages: [initialPage], pageParams: [undefined as string | undefined] }
      : undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const showDao = scope === 'cross';

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [query]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="flex flex-col gap-4">
      <ProposalFilters
        scope={scope}
        filters={filters}
        onChange={setFilters}
        daoOptions={daoOptions}
      />

      <div className="flex items-center justify-between font-mono text-caption text-ink-3">
        <span>{query.isError ? 'Failed to load proposals' : `${items.length} loaded`}</span>
        <SortControl sort={sort} onChange={setSort} />
      </div>

      {items.length === 0 && !query.isFetching ? (
        <p className="border border-line-3 bg-bg-2 py-10 text-center font-mono text-mono-body text-ink-3">
          No proposals match these filters.
        </p>
      ) : (
        <div className="border border-line-3 bg-bg-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20 bg-bg">ID</TableHead>
                <TableHead className="bg-bg">Proposal</TableHead>
                {showDao && <TableHead className="w-28 bg-bg">DAO</TableHead>}
                <TableHead className="w-24 bg-bg">State</TableHead>
                <TableHead className="w-[240px] bg-bg">Tally</TableHead>
                <TableHead className="w-40 bg-bg">Ends / closed</TableHead>
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
        </div>
      )}

      <div ref={sentinel} className="h-8" aria-hidden />
      {query.isFetchingNextPage && (
        <p className="py-4 text-center font-mono text-caption text-ink-3">Loading…</p>
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

function SortControl({
  sort,
  onChange,
}: {
  sort: ProposalSort;
  onChange: (s: ProposalSort) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-ink-4" htmlFor="proposal-sort">
        Sort
      </label>
      <select
        id="proposal-sort"
        value={sort.field}
        onChange={(e) => onChange({ ...sort, field: e.target.value as ProposalSort['field'] })}
        className="border border-line-3 bg-bg-2 px-2 py-1 text-ink"
      >
        {SORT_FIELDS.map((f) => (
          <option key={f} value={f}>
            {SORT_LABELS[f]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' })}
        aria-label={sort.dir === 'desc' ? 'Descending' : 'Ascending'}
        className={cn('border border-line-3 px-2 py-1 text-ink-2 hover:border-ink-3')}
      >
        {sort.dir === 'desc' ? '↓' : '↑'}
      </button>
    </div>
  );
}
