'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ProposalFilters } from './proposal-filters';
import { ProposalRow } from './proposal-row';
import { browserApi } from '@/lib/api/client';
import {
  fetchProposalPage,
  SORT_FIELDS,
  SORT_LABELS,
  toSearchParams,
  type ProposalFilters as Filters,
  type ProposalPage,
  type ProposalSort,
} from '@/lib/proposals/list';
import { cn } from '@/lib/utils';

export type ProposalListProps = {
  scope: 'cross' | 'dao';
  slug?: string;
  initialFilters: Filters;
  initialSort: ProposalSort;
  initialPage: ProposalPage;
  daoOptions?: { slug: string; name: string }[];
  sourceOptions?: string[];
};

/**
 * The shared filterable/sortable proposals list (§6.5 cross-DAO, §6.8 DAO-scoped). Filter + sort
 * state lives in React and is mirrored into the URL (shareable), driving a cursor-paged infinite
 * query. SSR seeds the first page for the initial URL state.
 */
export function ProposalList({
  scope,
  slug,
  initialFilters,
  initialSort,
  initialPage,
  daoOptions = [],
  sourceOptions = [],
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
    <div className="flex flex-col gap-8 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <ProposalFilters
          scope={scope}
          filters={filters}
          onChange={setFilters}
          daoOptions={daoOptions}
          sourceOptions={sourceOptions}
        />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between border-b border-line-2 pb-2 font-mono text-caption text-ink-3">
          <span>{query.isError ? 'Failed to load proposals' : `${items.length} loaded`}</span>
          <SortControl sort={sort} onChange={setSort} />
        </div>

        {items.length === 0 && !query.isFetching ? (
          <p className="py-10 text-center font-mono text-mono-body text-ink-3">
            No proposals match these filters.
          </p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={`${item.daoSlug}:${item.sourceType}:${item.sourceId}`}>
                <ProposalRow item={item} showDao={scope === 'cross'} />
              </li>
            ))}
          </ul>
        )}

        <div ref={sentinel} className="h-8" aria-hidden />
        {query.isFetchingNextPage && (
          <p className="py-4 text-center font-mono text-caption text-ink-3">Loading…</p>
        )}
      </div>
    </div>
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
