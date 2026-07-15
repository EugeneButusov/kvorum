'use client';

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { stateToVariant } from '@/components/proposal/state';
import { Power } from '@/components/ui/power';
import { StatePill } from '@/components/ui/state-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DelegateVote } from '@/lib/analytics/delegate';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const col = createColumnHelper<DelegateVote>();

/** Vote history (§6.11 §5): every vote this delegate cast, sortable by power/date, client-paginated. */
export function VoteHistory({ votes }: { votes: DelegateVote[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'castAt', desc: true }]);

  const columns = useMemo(
    () => [
      col.accessor('title', {
        id: 'proposal',
        header: 'Proposal',
        enableSorting: false,
        cell: (ctx) => {
          const v = ctx.row.original;
          const label = v.title ?? 'Untitled proposal';
          return v.href ? (
            <Link href={v.href} className="text-ink hover:text-primary">
              {label}
            </Link>
          ) : (
            <span className="text-ink">{label}</span>
          );
        },
      }),
      col.accessor((v) => v.choice, {
        id: 'choice',
        header: 'Choice',
        enableSorting: false,
        cell: (ctx) => {
          const c = ctx.getValue();
          return <span className="text-ink-2">{c == null ? '—' : `Choice ${c + 1}`}</span>;
        },
      }),
      col.accessor('power', {
        id: 'power',
        header: 'Voting power',
        cell: (ctx) => <Power value={ctx.getValue()} />,
      }),
      col.accessor('state', {
        id: 'state',
        header: 'Outcome',
        enableSorting: false,
        cell: (ctx) => (
          <StatePill state={stateToVariant(ctx.getValue())}>{ctx.getValue()}</StatePill>
        ),
      }),
      col.accessor((v) => v.castAt, {
        id: 'castAt',
        header: 'Voted',
        cell: (ctx) => {
          const at = ctx.getValue();
          return at ? (
            <span className="whitespace-nowrap text-ink-3" suppressHydrationWarning>
              {formatRelativeTime(new Date(at))}
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
    data: votes,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  if (votes.length === 0) {
    return <p className="font-mono text-mono-body text-ink-3">No votes recorded in this DAO.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
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

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between font-mono text-caption text-ink-3">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
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
      )}
    </div>
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
      className={cn(
        'border border-line-3 px-2 py-0.5 text-ink-2 transition-colors hover:border-ink-3',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
