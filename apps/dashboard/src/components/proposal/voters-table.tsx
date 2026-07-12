'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { IdentityChip } from '@/components/ui/identity-chip';
import { Power } from '@/components/ui/power';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { VoteTag } from '@/components/ui/vote-tag';
import { browserApi } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import {
  classifyChoice,
  scaleReportedPower,
  type ChoiceView,
  type VoteView,
} from '@/lib/proposals/detail';
import {
  fetchVotesPage,
  type ProposalPath,
  type VotesPage,
  type VotesSort,
} from '@/lib/proposals/votes';
import { cn } from '@/lib/utils';

type Row = {
  vote: VoteView;
  power: number;
  choiceLabel: string;
  choiceKind: 'for' | 'against' | 'abstain';
  pct: number;
};

const columnHelper = createColumnHelper<Row>();

const DEFAULT_SORT: SortingState = [{ id: 'power', desc: true }];

/** Map the table's sort state onto the votes endpoint's `sort` param (power + time are sortable). */
export function sortToParam(sorting: SortingState): VotesSort {
  const first = sorting[0];
  if (!first) return '-voting_power_reported';
  const field = first.id === 'castAt' ? 'cast_at' : 'voting_power_reported';
  return `${first.desc ? '-' : ''}${field}` as VotesSort;
}

/**
 * Voters table (§6.9): sortable by power/time, filterable by choice, paginated 50 at a time — all
 * server-side (the endpoint owns sort/filter/cursor), so the page ships only the first 50 and the
 * rest load on demand. `totalPower` (from the tally aggregate) makes "% of total" exact.
 */
export function VotersTable({
  path,
  choices,
  initialPage,
  totalPower,
}: {
  path: ProposalPath;
  choices: ChoiceView[];
  initialPage: VotesPage;
  totalPower: number;
}) {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT);
  const [choiceFilter, setChoiceFilter] = useState<number | undefined>(undefined);

  const sortParam = sortToParam(sorting);
  // The SSR first page was fetched with the default sort and no filter; seed the query with it only
  // while those hold, so a re-sort/filter fetches fresh instead of showing the seed.
  const isDefault = sortParam === '-voting_power_reported' && choiceFilter === undefined;

  const query = useInfiniteQuery({
    queryKey: [
      'proposal-votes',
      path.slug,
      path.source_type,
      path.source_id,
      sortParam,
      choiceFilter,
    ],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchVotesPage(browserApi, path, {
        sort: sortParam,
        cursor: pageParam,
        primaryChoice: choiceFilter,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: VotesPage) => last.nextCursor ?? undefined,
    initialData: isDefault
      ? { pages: [initialPage], pageParams: [undefined as string | undefined] }
      : undefined,
  });

  const votes = useMemo(() => query.data?.pages.flatMap((p) => p.votes) ?? [], [query.data]);

  const labelOf = useMemo(() => {
    const map = new Map(choices.map((c) => [c.index, c.value]));
    return (i: number | null) => (i == null ? '—' : (map.get(i) ?? `Choice ${i + 1}`));
  }, [choices]);

  const rows = useMemo<Row[]>(
    () =>
      votes.map((vote) => {
        const power = scaleReportedPower(vote.votingPowerReported);
        const label = labelOf(vote.primaryChoice);
        return {
          vote,
          power,
          choiceLabel: label,
          choiceKind: classifyChoice(label),
          pct: totalPower > 0 ? (power / totalPower) * 100 : 0,
        };
      }),
    [votes, labelOf, totalPower],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor((r) => r.vote.voter, {
        id: 'voter',
        header: 'Voter',
        enableSorting: false,
        cell: (ctx) => {
          const voter = ctx.getValue();
          return (
            <IdentityChip
              address={voter.address}
              name={voter.displayName ?? undefined}
              copyable={false}
              scorecardHref={`/actors/${voter.address}`}
            />
          );
        },
      }),
      columnHelper.accessor('choiceLabel', {
        id: 'choice',
        header: 'Choice',
        enableSorting: false,
        cell: (ctx) => <VoteTag choice={ctx.row.original.choiceKind}>{ctx.getValue()}</VoteTag>,
      }),
      columnHelper.accessor('power', {
        id: 'power',
        header: 'Voting power',
        cell: (ctx) => <Power value={ctx.getValue()} />,
      }),
      columnHelper.accessor('pct', {
        id: 'pct',
        header: '% of total',
        enableSorting: false,
        cell: (ctx) => (
          <span className="tabular-nums text-ink-3">{ctx.getValue().toFixed(2)}%</span>
        ),
      }),
      columnHelper.accessor((r) => r.vote.reason, {
        id: 'reason',
        header: 'Rationale',
        enableSorting: false,
        cell: (ctx) => {
          const reason = ctx.getValue();
          return reason ? (
            <span className="line-clamp-2 max-w-xs text-ink-2" title={reason}>
              {reason}
            </span>
          ) : (
            <span className="text-ink-4">—</span>
          );
        },
      }),
      columnHelper.accessor((r) => r.vote.castAt, {
        id: 'castAt',
        header: 'Voted',
        cell: (ctx) => {
          const castAt = ctx.getValue();
          return castAt ? (
            <span className="whitespace-nowrap text-ink-3" suppressHydrationWarning>
              {formatRelativeTime(new Date(castAt))}
            </span>
          ) : (
            <span className="text-ink-4">—</span>
          );
        },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    manualFiltering: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const distinctChoices = useMemo(() => choices.filter((c) => c.value !== '—'), [choices]);

  if (initialPage.votes.length === 0 && votes.length === 0 && !query.isFetching) {
    return <p className="font-mono text-mono-body text-ink-3">No votes recorded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Choice filter */}
      <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
        <span className="text-ink-3">Filter:</span>
        <FilterChip active={choiceFilter === undefined} onClick={() => setChoiceFilter(undefined)}>
          All
        </FilterChip>
        {distinctChoices.map((c) => (
          <FilterChip
            key={c.index}
            active={choiceFilter === c.index}
            onClick={() => setChoiceFilter(c.index)}
          >
            {c.value}
          </FilterChip>
        ))}
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                return (
                  <TableHead key={header.id}>
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 uppercase tracking-[0.04em] hover:text-ink"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden className="text-ink-4">
                          {dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      <div className="flex items-center justify-between font-mono text-caption text-ink-3">
        <span>{query.isError ? 'Failed to load votes' : `Showing ${rows.length}`}</span>
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="border border-line-3 px-2 py-0.5 text-ink-2 transition-colors hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'border px-2 py-0.5 uppercase tracking-[0.04em] transition-colors',
        active
          ? 'border-primary bg-primary text-bg-2'
          : 'border-line-3 text-ink-2 hover:border-ink-3',
      )}
    >
      {children}
    </button>
  );
}
