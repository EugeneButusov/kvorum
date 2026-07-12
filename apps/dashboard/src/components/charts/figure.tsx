'use client';

import { useId, useState, type ReactNode } from 'react';

import { DataTable, type ChartTableModel } from './data-table';
import { cn } from '@/lib/utils';

export type ChartLegendItem = { label: string; color: string };

export type FigureProps = {
  title: string;
  /** The accessible-alternative data (§6.19 / ADR-085) — every chart supplies one. */
  table: ChartTableModel;
  /** Series legend; shown for 2+ series so identity is never colour-alone. */
  legend?: ChartLegendItem[];
  caption?: string;
  children: ReactNode;
  className?: string;
};

/**
 * The frame every chart lives in (ADR-085). Titles the chart, carries the legend, and provides the
 * mandated "View as table" toggle that swaps the SVG for a `<table>` of the same data. The chart is
 * exposed to assistive tech as a labelled `img`; the table is the real accessible content.
 */
export function Figure({ title, table, legend, caption, children, className }: FigureProps) {
  const [asTable, setAsTable] = useState(false);
  const regionId = useId();

  return (
    <figure className={cn('flex flex-col gap-3', className)}>
      <figcaption className="flex items-center justify-between gap-4 border-b border-line-3 pb-2">
        <span className="font-mono text-body font-semibold uppercase tracking-[0.04em] text-ink">
          {title}
        </span>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-expanded={asTable}
          aria-controls={regionId}
          className="border border-line-3 px-2 py-0.5 font-mono text-caption text-ink-2 transition-colors hover:border-ink-3"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </figcaption>

      {legend && legend.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-caption text-ink-2">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div id={regionId}>
        {asTable ? (
          <DataTable model={table} />
        ) : (
          <div role="img" aria-label={title} className="w-full">
            {children}
          </div>
        )}
      </div>

      {caption && <figcaption className="font-mono text-caption text-ink-3">{caption}</figcaption>}
    </figure>
  );
}
