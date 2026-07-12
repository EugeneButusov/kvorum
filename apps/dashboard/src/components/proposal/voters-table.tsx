'use client';

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
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
import { formatRelativeTime } from '@/lib/format';
import {
  classifyChoice,
  scaleReportedPower,
  type ChoiceView,
  type VoteView,
} from '@/lib/proposals/detail';
import { cn } from '@/lib/utils';

type Row = {
  vote: VoteView;
  power: number;
  choiceLabel: string;
  choiceKind: 'for' | 'against' | 'abstain';
  pct: number;
};

const columnHelper = createColumnHelper<Row>();

const PAGE_SIZE = 50;

/** Voters table (§6.9): sortable, filterable by choice, paginated. Default sort: power descending. */
export function VotersTable({ votes, choices }: { votes: VoteView[]; choices: ChoiceView[] }) {
  const rows = useMemo<Row[]>(() => {
    const labelOf = (i: number | null) =>
      i == null ? '—' : (choices.find((c) => c.index === i)?.value ?? `Choice ${i + 1}`);
    const total = votes.reduce((sum, v) => sum + scaleReportedPower(v.votingPowerReported), 0);
    return votes.map((vote) => {
      const power = scaleReportedPower(vote.votingPowerReported);
      const label = labelOf(vote.primaryChoice);
      return {
        vote,
        power,
        choiceLabel: label,
        choiceKind: classifyChoice(label),
        pct: total > 0 ? (power / total) * 100 : 0,
      };
    });
  }, [votes, choices]);

  const [sorting, setSorting] = useState<SortingState>([{ id: 'power', desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

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
        filterFn: (row, _id, value: string) => row.original.choiceLabel === value,
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
        sortingFn: (a, b) =>
          String(a.original.vote.castAt ?? '').localeCompare(String(b.original.vote.castAt ?? '')),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const distinctChoices = useMemo(
    () => [...new Set(rows.map((r) => r.choiceLabel))].filter((l) => l !== '—'),
    [rows],
  );
  const choiceFilter = (table.getColumn('choice')?.getFilterValue() as string | undefined) ?? '';
  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageIndex = table.getState().pagination.pageIndex;
  const from = filteredCount === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const to = Math.min((pageIndex + 1) * PAGE_SIZE, filteredCount);

  if (votes.length === 0) {
    return <p className="font-mono text-mono-body text-ink-3">No votes recorded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Choice filter */}
      <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
        <span className="text-ink-3">Filter:</span>
        <FilterChip
          active={choiceFilter === ''}
          onClick={() => table.getColumn('choice')?.setFilterValue(undefined)}
        >
          All
        </FilterChip>
        {distinctChoices.map((label) => (
          <FilterChip
            key={label}
            active={choiceFilter === label}
            onClick={() => table.getColumn('choice')?.setFilterValue(label)}
          >
            {label}
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
        <span>
          {from}–{to} of {filteredCount}
        </span>
        <div className="flex gap-2">
          <PageButton onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            ← Prev
          </PageButton>
          <PageButton onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next →
          </PageButton>
        </div>
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

function PageButton({
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
      className="border border-line-3 px-2 py-0.5 text-ink-2 transition-colors hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
