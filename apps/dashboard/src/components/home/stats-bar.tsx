import { formatCompactNumber } from '@/lib/format';

/**
 * Tagline + cross-DAO quick stats (§6.4 §1). Only the DAO count has a data source today; the
 * proposals / votes / forum-thread counters need a stats aggregate endpoint (none yet), so they're
 * not shown rather than faked.
 */
export function StatsBar({ daoCount }: { daoCount: number }) {
  return (
    <section className="flex flex-col gap-4 border-b border-line-2 pb-8">
      <h1 className="text-h1 font-semibold text-ink">Governance intelligence for DeFi DAOs</h1>
      <dl className="flex flex-wrap gap-x-10 gap-y-2 font-mono text-caption">
        <div className="flex items-baseline gap-2">
          <dt className="uppercase tracking-[0.04em] text-ink-4">DAOs tracked</dt>
          <dd className="text-body-lg tabular-nums text-ink">{formatCompactNumber(daoCount)}</dd>
        </div>
      </dl>
    </section>
  );
}
