import Link from 'next/link';

import { daoVariant } from '@/components/proposal/state';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';

const KPI_COLUMNS = 2;

const isLastColumn = (index: number) => (index + 1) % KPI_COLUMNS === 0;
const isLastRow = (index: number, total: number) =>
  index >= Math.floor((total - 1) / KPI_COLUMNS) * KPI_COLUMNS;
const isDanglingLast = (index: number, total: number) =>
  index === total - 1 && total % KPI_COLUMNS !== 0;

export type HealthKpi = {
  label: string;
  value: string;
  deltaPp?: number | null;
  higherIsWorse?: boolean;
};

export function HealthHeader({
  name,
  slug,
  contractAddress,
  governorLabel,
  forumUrl,
  kpis,
}: {
  name: string;
  slug: string;
  contractAddress: string;
  governorLabel: string;
  forumUrl: string | null;
  kpis: HealthKpi[];
}) {
  return (
    <header className="grid gap-8 border-b border-line pb-6 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-3">
        {(contractAddress || governorLabel) && (
          <div className="flex items-center gap-2.5 font-mono text-caption text-ink-3">
            <Pill dao={daoVariant(slug)}>{slug}</Pill>
            {contractAddress && <span>{contractAddress}</span>}
            {contractAddress && governorLabel && <span>·</span>}
            {governorLabel && <span>{governorLabel.toLowerCase()}</span>}
          </div>
        )}
        <h1 className="font-mono text-h1 font-semibold tracking-[-0.01em] text-ink">{name}</h1>
        <p className="max-w-[64ch] text-body-lg text-ink-2">
          Stewarding {name}? This view is built for you &mdash; how the DAO&rsquo;s governance is
          behaving, and what to watch. A public page designed for operators.
        </p>
        <nav className="flex flex-wrap gap-4 font-mono text-caption text-ink-3">
          <MetaLink href={`/daos/${slug}/proposals`}>View proposals →</MetaLink>
          <MetaLink href={`/daos/${slug}/delegates`}>Top delegates →</MetaLink>
          {forumUrl && (
            <MetaLink href={forumUrl} external>
              Forum threads →
            </MetaLink>
          )}
        </nav>
      </div>

      {kpis.length > 0 && (
        <dl className="grid grid-cols-2 border border-line tabular-nums">
          {kpis.map((kpi, i) => (
            <div
              key={kpi.label}
              className={cn(
                'min-w-[140px] border-line px-[18px] py-3',
                !isLastColumn(i) && 'border-r',
                !isLastRow(i, kpis.length) && 'border-b',
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

function MetaLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="border-b border-line-2 text-ink-2 transition-colors hover:border-primary hover:text-primary"
      >
        {children}
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="border-b border-line-2 text-ink-2 transition-colors hover:border-primary hover:text-primary"
    >
      {children}
    </Link>
  );
}
