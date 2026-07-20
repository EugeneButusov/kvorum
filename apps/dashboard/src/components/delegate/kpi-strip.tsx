import type { ReactNode } from 'react';

export type Kpi = {
  label: string;
  /** The figure. `null` renders an em-dash — an unmeasured KPI must not read as zero. */
  value: ReactNode | null;
  /** Supporting context under the figure: what the number is of, or why it is absent. */
  sub: string;
  tone?: 'default' | 'accent';
};

/**
 * The KPI strip from the reference (`.kpis`): equal bordered cells, each a small uppercase label, a
 * large tabular figure, and a sub-caption.
 *
 * The sub-caption is the part that carries the weight — "412" means little, "412 · of 458 eligible"
 * means a lot — so every cell has one, including the cells whose figure we cannot yet measure. Those
 * render an em-dash and say why, per ADR-086: an honest absence, never a zero standing in for
 * missing data.
 */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    // Collapsed borders rather than a bordered container plus per-cell rules: the grid reflows to
    // three and two columns, so `:last-child` cannot tell which cell ends a row, and every
    // end-of-row cell doubled its border against the container's. Each cell draws its own frame and
    // overlaps its neighbour by a pixel, so shared edges land on top of each other at any column
    // count. The reference can use `:last-child` because its five columns never wrap.
    <section className="grid grid-cols-2 pl-px pt-px sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="-ml-px -mt-px border border-solid border-line px-4 py-3.5">
          <div className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">
            {item.label}
          </div>
          <div
            className={`mt-1 font-mono text-h3 font-semibold tabular-nums ${
              item.tone === 'accent' ? 'text-primary' : 'text-ink'
            }`}
          >
            {item.value ?? <span className="text-ink-4">—</span>}
          </div>
          <div className="mt-0.5 font-mono text-pill text-ink-3">{item.sub}</div>
        </div>
      ))}
    </section>
  );
}
