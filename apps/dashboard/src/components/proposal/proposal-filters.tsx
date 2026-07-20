'use client';

import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { EMPTY_FILTERS, type ProposalFilters } from '@/lib/proposals/list';

// A curated set of states to filter by (source states fold onto these); mirrors the pill treatments.
export const STATE_OPTIONS = [
  'active',
  'pending',
  'succeeded',
  'executed',
  'defeated',
  'queued',
  'cancelled',
  'expired',
];

/** Sentinel for the leading "All" segment: selected when the facet has no explicit selection. */
const ALL = '__all__';

export type ProposalFiltersProps = {
  scope: 'cross' | 'dao';
  filters: ProposalFilters;
  onChange: (next: ProposalFilters) => void;
  /** Cross-DAO DAO options. */
  daoOptions: { slug: string; name: string }[];
};

/**
 * Horizontal filter strip (§6.5 / §6.8), matching the reference: DAO (cross-DAO only) and State, each
 * a segmented control. Filter state is lifted to the list, which mirrors it into the URL. The
 * reference's remaining facets — a mismatch-severity "Flag" filter and full-text search — need
 * list-API support / M5 and aren't offered yet.
 */
export function ProposalFilters({ scope, filters, onChange, daoOptions }: ProposalFiltersProps) {
  /** Multi-select facet: empty selection renders as "All"; picking "All" clears it. */
  const multiValue = (selected: string[]) => (selected.length > 0 ? selected : [ALL]);
  const onMultiChange = (key: 'dao' | 'state', selected: string[], next: string[]) => {
    // Diff against what was *rendered* (which is [ALL] for an empty facet), not the raw filter —
    // otherwise every item reads as newly added and picking one is mistaken for picking "All".
    const rendered = multiValue(selected);
    const added = next.find((v) => !rendered.includes(v));
    const cleared = added === ALL || next.length === 0;
    onChange({ ...filters, [key]: cleared ? [] : next.filter((v) => v !== ALL) });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border border-line-3 bg-bg-2 px-3.5 py-2.5 font-mono">
      {scope === 'cross' && daoOptions.length > 0 && (
        <>
          <Group label="DAO">
            <Segmented
              type="multiple"
              aria-label="Filter by DAO"
              value={multiValue(filters.dao)}
              onValueChange={(next: string[]) => onMultiChange('dao', filters.dao, next)}
            >
              <SegmentedItem value={ALL}>All</SegmentedItem>
              {daoOptions.map((d) => (
                <SegmentedItem key={d.slug} value={d.slug}>
                  {d.name}
                </SegmentedItem>
              ))}
            </Segmented>
          </Group>
          <Sep />
        </>
      )}

      <Group label="State">
        <Segmented
          type="multiple"
          aria-label="Filter by state"
          value={multiValue(filters.state)}
          onValueChange={(next: string[]) => onMultiChange('state', filters.state, next)}
        >
          <SegmentedItem value={ALL}>All</SegmentedItem>
          {STATE_OPTIONS.map((s) => (
            <SegmentedItem key={s} value={s}>
              {s}
            </SegmentedItem>
          ))}
        </Segmented>
      </Group>

      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="ml-auto border border-line-3 px-2.5 py-1 text-pill text-ink-3 transition-colors hover:border-line hover:text-ink"
      >
        clear ✕
      </button>
    </div>
  );
}

function Sep() {
  return <span aria-hidden className="hidden h-6 w-px shrink-0 bg-line-3 sm:block" />;
}

/**
 * A facet: its label, then the segmented control. The control has more segments than fit a phone
 * width, so it wraps onto further rows — every option stays on screen and reachable, rather than
 * hiding behind a sideways scroll.
 */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full items-start gap-2">
      <span className="shrink-0 py-1 text-caption uppercase tracking-[0.06em] text-ink-3">
        {label}
      </span>
      {children}
    </div>
  );
}
