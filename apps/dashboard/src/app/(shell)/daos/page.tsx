import type { Metadata } from 'next';
import Link from 'next/link';

import { Crumb } from '@/components/shell/crumb';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { serverApi } from '@/lib/api/client';
import { loadDaoDirectory, type DaoDirectoryEntry } from '@/lib/daos/directory';

export const metadata: Metadata = {
  title: 'DAOs — Kvorum',
  description:
    'Every DAO Kvorum tracks, normalized across governors — with pass rate and voting-power concentration.',
  alternates: { canonical: '/daos' },
};

// The directory changes rarely and the per-DAO metrics fan out to several analytics calls; ISR keeps
// that off the request path.
export const revalidate = 300;

export default async function DaosPage() {
  const daos = await loadDaoDirectory(serverApi(), Date.now());

  return (
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'DAOs' }]} />
      <main className="mx-auto flex w-full max-w-[var(--max-page)] flex-col gap-7 px-4 pb-16 pt-7 md:px-8">
        <div className="grid gap-6 border-b border-line pb-6 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="flex flex-col gap-2">
            <h1 className="font-mono text-h1 font-semibold tracking-[-0.01em] text-ink">DAOs</h1>
            <p className="max-w-[60ch] text-body-lg text-ink-2">
              Every DAO Kvorum tracks, normalized across governors. Open any row for its proposals,
              health, and delegates.
            </p>
          </div>
          {daos.length > 0 && (
            <dl className="flex border border-line">
              <Stat label="Tracked" value={String(daos.length)} />
            </dl>
          )}
        </div>

        {daos.length === 0 ? (
          <p className="border border-line-3 bg-bg-2 py-10 text-center font-mono text-mono-body text-ink-3">
            The DAO directory is temporarily unavailable.
          </p>
        ) : (
          <div className="border border-line-3 bg-bg-2">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="bg-bg">DAO</TableHead>
                  <TableHead className="bg-bg text-right">Pass rate · 90d</TableHead>
                  <TableHead className="bg-bg text-right">Top-10 VP · 90d</TableHead>
                  <TableHead className="bg-bg" aria-label="Open" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {daos.map((dao) => (
                  <DaoRow key={dao.slug} dao={dao} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="font-mono text-caption text-ink-3">
          TVL, treasury, a composite health grade, activity trends, and mismatch flags land with
          their data sources (external feeds / analytics / M5).
        </p>
      </main>
    </>
  );
}

function DaoRow({ dao }: { dao: DaoDirectoryEntry }) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="flex items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center border border-line-2 font-mono text-small font-bold text-ink">
            {dao.name.charAt(0).toUpperCase()}
          </span>
          <div className="flex flex-col gap-0.5">
            <Link
              href={`/daos/${dao.slug}`}
              className="font-mono text-body-lg font-semibold text-ink hover:text-primary"
            >
              {dao.name}
            </Link>
            {dao.governors.length > 0 && (
              <span className="font-mono text-pill text-ink-3">{dao.governors.join(' · ')}</span>
            )}
            <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-pill">
              {dao.forumUrl && (
                <a
                  href={dao.forumUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline"
                >
                  forum ↗
                </a>
              )}
              {dao.websiteUrl && (
                <a
                  href={dao.websiteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline"
                >
                  site ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right align-top">
        {formatPct(dao.passRatePct)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right align-top">
        <span>{formatPct(dao.top10Pct)}</span>
        {dao.top10Delta != null && Math.abs(dao.top10Delta) >= 0.1 && (
          <span className="ml-1.5 text-pill text-ink-4">
            {dao.top10Delta > 0 ? '↑' : '↓'}
            {Math.abs(dao.top10Delta).toFixed(1)}pp
          </span>
        )}
      </TableCell>
      <TableCell className="text-right align-top">
        <Link
          href={`/daos/${dao.slug}`}
          aria-label={`Open ${dao.name}`}
          className="text-primary hover:underline"
        >
          →
        </Link>
      </TableCell>
    </TableRow>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] px-4 py-2.5">
      <dt className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-mono text-h3 font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function formatPct(value: number | null): string {
  return value == null ? '—' : `${value}%`;
}
