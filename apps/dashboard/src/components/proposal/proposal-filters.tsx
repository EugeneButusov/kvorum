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
 * Horizontal filter strip (§6.5 / §6.8): DAO / state / type facets + a voting-start range, above the
 * table. All state is lifted to the list, which mirrors it into the URL. Full-text search and a
 * mismatch-severity facet from the reference need list-API support / M5 and aren't offered yet.
 *
 * Each facet is a segmented control, per the reference's `.seg`: one joined group with a leading
 * "All", not free-standing chips.
 */
export function ProposalFilters({ scope, filters, onChange, daoOptions }: ProposalFiltersProps) {
  const toDate = (value: string) => (value ? `${value}T00:00:00.000Z` : null);
  const fromDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

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

      <Sep />
      <Group label="Type">
        <Segmented
          type="single"
          aria-label="Filter by type"
          value={filters.binding === null ? ALL : filters.binding ? 'binding' : 'signaling'}
          onValueChange={(next: string) =>
            onChange({
              ...filters,
              binding: next === 'binding' ? true : next === 'signaling' ? false : null,
            })
          }
        >
          <SegmentedItem value={ALL}>All</SegmentedItem>
          <SegmentedItem value="binding">Binding</SegmentedItem>
          <SegmentedItem value="signaling">Signaling</SegmentedItem>
        </Segmented>
      </Group>

      <Sep />
      <Group label="Voting start">
        <input
          type="date"
          aria-label="Voting start from"
          value={fromDate(filters.startsMin)}
          onChange={(e) => onChange({ ...filters, startsMin: toDate(e.target.value) })}
          className="border border-line-2 bg-bg px-2 py-[5px] text-pill text-ink"
        />
        <span className="text-ink-4">→</span>
        <input
          type="date"
          aria-label="Voting start to"
          value={fromDate(filters.startsMax)}
          onChange={(e) => onChange({ ...filters, startsMax: toDate(e.target.value) })}
          className="border border-line-2 bg-bg px-2 py-[5px] text-pill text-ink"
        />
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

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-caption uppercase tracking-[0.06em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}
