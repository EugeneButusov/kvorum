import Link from 'next/link';

import type { TopDelegate } from '@/lib/analytics/health';
import { formatCompactNumber } from '@/lib/format';

/** Top delegates (§6.6 §5): the five largest by current voting power, linking to their scorecards. */
export function TopDelegates({ slug, delegates }: { slug: string; delegates: TopDelegate[] }) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3 border-b border-line-2 pb-2">
        <h2 className="text-h3 font-semibold text-ink">Top delegates</h2>
        <Link
          href={`/daos/${slug}/delegates`}
          className="font-mono text-caption text-ink-2 hover:text-ink"
        >
          All delegates →
        </Link>
      </header>
      {delegates.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No delegate voting power recorded.</p>
      ) : (
        <ol className="flex flex-col">
          {delegates.map((d, i) => (
            <li key={d.address}>
              <Link
                href={`/daos/${slug}/delegates/${d.address}`}
                className="flex items-center gap-3 border-b border-line-3 py-2.5 font-mono text-mono-body transition-colors hover:bg-bg-3"
              >
                <span className="w-5 tabular-nums text-ink-4">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{d.label}</span>
                <span className="tabular-nums text-ink-2">{formatCompactNumber(d.power)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
