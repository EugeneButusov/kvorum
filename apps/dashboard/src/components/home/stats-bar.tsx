import { formatCompactNumber } from '@/lib/format';

/**
 * Tagline + cross-DAO quick stats (§6.4 §1). Only the DAO count has a data source today; the
 * proposals / votes / forum-thread counters need a stats aggregate endpoint (none yet), so they're
 * not shown rather than faked.
 */
export function StatsBar({ daoCount }: { daoCount: number }) {
  return (
    <section className="flex flex-col gap-3.5 border-b border-line pb-7">
      <h1 className="max-w-[18ch] font-mono text-hero font-semibold leading-[1.05] tracking-[-0.01em] text-ink">
        Governance intelligence for DeFi <span className="text-primary">DAOs</span>.
      </h1>
      <p className="max-w-[56ch] text-body-lg leading-[1.62] text-ink-2">
        Indexed across <b className="font-semibold text-ink">Compound</b>,{' '}
        <b className="font-semibold text-ink">Aave</b>, and{' '}
        <b className="font-semibold text-ink">Lido</b>. Mismatch detection between proposal text and
        on-chain calldata. Free dashboard, free API, no auth required for browsing.
      </p>
      <dl className="mt-1 flex flex-wrap gap-x-10 gap-y-2 font-mono text-caption">
        <div className="flex items-baseline gap-2">
          <dt className="uppercase tracking-[0.04em] text-ink-4">DAOs tracked</dt>
          <dd className="text-body-lg tabular-nums text-ink">{formatCompactNumber(daoCount)}</dd>
        </div>
      </dl>
    </section>
  );
}
