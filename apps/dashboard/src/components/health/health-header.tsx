import Link from 'next/link';

import { cn } from '@/lib/utils';

const KPI_COLUMNS = 2;

const isLastColumn = (index: number) => (index + 1) % KPI_COLUMNS === 0;
/** True for every cell on the final row, whether or not that row is full. */
const isLastRow = (index: number, total: number) =>
  index >= Math.floor((total - 1) / KPI_COLUMNS) * KPI_COLUMNS;
/** The final cell when it would otherwise sit alone on its row. */
const isDanglingLast = (index: number, total: number) =>
  index === total - 1 && total % KPI_COLUMNS !== 0;

export type HealthKpi = {
  label: string;
  /** Rendered as-is; pass an em dash for "we don't have this yet". */
  value: string;
  /** Signed change over the trailing 90 days, in percentage points. */
  deltaPp?: number | null;
  /** For a metric where "up" is a concern (concentration) rather than an improvement. */
  higherIsWorse?: boolean;
};

/**
 * DAO health header (§6.7): identity + operator framing on the left, headline metrics on the right,
 * mirroring the design's `.dao-head` grid.
 *
 * The design also shows a composite letter grade, participation, and an open-flag count. Those have
 * no data source in v1 (no grading model, no participation endpoint, and the mismatch detector is an
 * M5 AI feature), so they are omitted rather than mocked — ADR-086: never render fabricated numbers
 * as if they were real. The cells below are all served by live analytics.
 */
export function HealthHeader({
  name,
  slug,
  kpis,
}: {
  name: string;
  slug: string;
  kpis: HealthKpi[];
}) {
  return (
    <header className="grid gap-8 border-b border-line pb-6 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-3">
        <h1 className="font-mono text-h1 font-semibold tracking-[-0.01em] text-ink">
          {name} — health
        </h1>
        <p className="max-w-[64ch] text-body-lg text-ink-2">
          Stewarding {name}? This view is built for you — how the DAO&rsquo;s governance is
          behaving, and what to watch. A public page designed for operators.
        </p>
        <nav className="flex flex-wrap gap-4 font-mono text-caption text-ink-3">
          <MetaLink href={`/daos/${slug}`}>DAO overview →</MetaLink>
          <MetaLink href={`/daos/${slug}/proposals`}>View proposals →</MetaLink>
          <MetaLink href={`/daos/${slug}/delegates`}>Top delegates →</MetaLink>
        </nav>
      </div>

      {kpis.length > 0 && (
        <dl className="grid grid-cols-2 border border-line tabular-nums">
          {kpis.map((kpi, i) => (
            <div
              key={kpi.label}
              className={cn(
                'min-w-[150px] border-line px-[18px] py-3',
                // Interior rules only: the container draws the outer box. Computed rather than
                // nth-child so an odd number of cells (a metric with no data source is dropped,
                // not mocked) doesn't leave a rule dangling mid-row.
                !isLastColumn(i) && 'border-r',
                !isLastRow(i, kpis.length) && 'border-b',
                // A trailing odd cell fills its row rather than leaving an empty box.
                isDanglingLast(i, kpis.length) && 'col-span-2',
              )}
            >
              <dt className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">
                {kpi.label}
              </dt>
              <dd className="mt-0.5 font-mono text-h3 font-semibold text-ink">
                {kpi.value}
                <Delta deltaPp={kpi.deltaPp} higherIsWorse={kpi.higherIsWorse} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

function Delta({ deltaPp, higherIsWorse }: { deltaPp?: number | null; higherIsWorse?: boolean }) {
  if (deltaPp == null || deltaPp === 0) return null;
  const up = deltaPp > 0;
  const bad = higherIsWorse === true ? up : !up;
  return (
    <span
      className={cn(
        'ml-1.5 font-mono text-caption font-normal',
        bad ? 'text-warn' : 'text-primary',
      )}
    >
      {up ? '↑' : '↓'} {Math.abs(deltaPp).toFixed(1)}pp
    </span>
  );
}

function MetaLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="border-b border-line-2 text-ink-2 transition-colors hover:border-primary hover:text-primary"
    >
      {children}
    </Link>
  );
}
