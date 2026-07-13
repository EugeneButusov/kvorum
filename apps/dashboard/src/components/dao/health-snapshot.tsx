import Link from 'next/link';

/** Health snapshot (§6.6 §4): headline metrics with click-through to the full health dashboard. */
export function HealthSnapshot({
  slug,
  gini,
  top10Pct,
  passRatePct,
}: {
  slug: string;
  gini: number | null;
  top10Pct: number | null;
  passRatePct: number | null;
}) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3 border-b border-line-2 pb-2">
        <h2 className="text-h3 font-semibold text-ink">Health snapshot</h2>
        <Link
          href={`/daos/${slug}/health`}
          className="font-mono text-caption text-ink-2 hover:text-ink"
        >
          Full dashboard →
        </Link>
      </header>
      <dl className="grid grid-cols-3 gap-4 font-mono text-caption">
        <Metric label="Gini" value={gini == null ? '—' : gini.toFixed(2)} />
        <Metric label="Top-10 share" value={top10Pct == null ? '—' : `${top10Pct.toFixed(1)}%`} />
        <Metric label="Pass rate" value={passRatePct == null ? '—' : `${passRatePct}%`} />
      </dl>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border border-line-2 bg-bg-2 p-3">
      <dt className="uppercase tracking-[0.04em] text-ink-4">{label}</dt>
      <dd className="text-body-lg tabular-nums text-ink">{value}</dd>
    </div>
  );
}
