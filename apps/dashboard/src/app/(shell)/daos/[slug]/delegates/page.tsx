import Link from 'next/link';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { serverApi } from '@/lib/api/client';
import { daoNameFromSlug } from '@/lib/dao/tracked';
import { loadDelegateLeaderboard, type DelegateLeaderboardEntry } from '@/lib/daos/delegates';
import { formatCompactNumber, truncateAddress } from '@/lib/format';

// Delegates change slowly; the leaderboard is one batched analytics call. ISR keeps it cheap.
export const revalidate = 300;

export default async function DaoDelegatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = daoNameFromSlug(slug);
  const delegates = await loadDelegateLeaderboard(serverApi(), slug, 50);

  return (
    <div className="mx-auto flex w-full max-w-[var(--max-page)] flex-col gap-6 px-4 pb-16 pt-7 md:px-8">
      <div className="flex flex-col gap-2 border-b border-line pb-5">
        <h1 className="font-mono text-h1 font-semibold tracking-[-0.01em] text-ink">
          {name} delegates
        </h1>
        <p className="max-w-[60ch] text-body-lg text-ink-2">
          Delegates ranked by current received voting power. Open any row for their scorecard —
          votes, participation, and alignment.
        </p>
      </div>

      {delegates.length === 0 ? (
        <p className="border border-line-3 bg-bg-2 py-10 text-center font-mono text-mono-body text-ink-3">
          No delegate voting power is indexed for {name} yet.
        </p>
      ) : (
        <div className="border border-line-3 bg-bg-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 bg-bg text-right">#</TableHead>
                <TableHead className="bg-bg">Delegate</TableHead>
                <TableHead className="bg-bg text-right">Voting power</TableHead>
                <TableHead className="bg-bg text-right">Share</TableHead>
                <TableHead className="bg-bg text-right">Delegators</TableHead>
                <TableHead className="bg-bg" aria-label="Open" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {delegates.map((d) => (
                <DelegateRow key={d.address} delegate={d} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function DelegateRow({ delegate }: { delegate: DelegateLeaderboardEntry }) {
  return (
    <TableRow>
      <TableCell className="text-right align-top text-ink-3">{delegate.rank}</TableCell>
      <TableCell className="align-top">
        <Link
          href={delegate.href}
          className="font-mono text-body-lg font-semibold text-ink hover:text-primary"
        >
          {delegate.displayName ?? truncateAddress(delegate.address)}
        </Link>
        {delegate.displayName && (
          <div className="font-mono text-pill text-ink-4">{truncateAddress(delegate.address)}</div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right align-top text-ink">
        {formatCompactNumber(delegate.votingPower)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right align-top text-ink-2">
        {delegate.sharePct}%
      </TableCell>
      <TableCell className="text-right align-top text-ink-2">{delegate.delegatorCount}</TableCell>
      <TableCell className="text-right align-top">
        <Link
          href={delegate.href}
          aria-label={`Open ${delegate.displayName ?? delegate.address}`}
          className="text-primary hover:underline"
        >
          →
        </Link>
      </TableCell>
    </TableRow>
  );
}
