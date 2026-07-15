'use client';

import { EMPTY_FILTERS, type ProposalFilters } from '@/lib/proposals/list';
import { sourceLabel } from '@/lib/proposals/source';
import { cn } from '@/lib/utils';

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

export type ProposalFiltersProps = {
  scope: 'cross' | 'dao';
  filters: ProposalFilters;
  onChange: (next: ProposalFilters) => void;
  /** Cross-DAO DAO options. */
  daoOptions: { slug: string; name: string }[];
  /** DAO-scoped source options (filter shown only when the DAO has more than one). */
  sourceOptions: string[];
};

/**
 * Horizontal filter strip (§6.5 / §6.8): DAO / state / type facets + a voting-start range, above the
 * table. All state is lifted to the list, which mirrors it into the URL. Full-text search and a
 * mismatch-severity facet from the reference need list-API support / M5 and aren't offered yet.
 */
export function ProposalFilters({
  scope,
  filters,
  onChange,
  daoOptions,
  sourceOptions,
}: ProposalFiltersProps) {
  const toggleIn = (key: 'dao' | 'state', value: string) => {
    const set = new Set(filters[key]);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    onChange({ ...filters, [key]: [...set] });
  };

  const toDate = (value: string) => (value ? `${value}T00:00:00.000Z` : null);
  const fromDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-line-3 bg-bg-2 px-3.5 py-2.5 font-mono text-caption">
      {scope === 'cross' && daoOptions.length > 0 && (
        <>
          <Group label="DAO">
            {daoOptions.map((d) => (
              <Chip
                key={d.slug}
                active={filters.dao.includes(d.slug)}
                onClick={() => toggleIn('dao', d.slug)}
              >
                {d.name}
              </Chip>
            ))}
          </Group>
          <Sep />
        </>
      )}

      <Group label="State">
        {STATE_OPTIONS.map((s) => (
          <Chip key={s} active={filters.state.includes(s)} onClick={() => toggleIn('state', s)}>
            {s}
          </Chip>
        ))}
      </Group>

      {scope === 'dao' && sourceOptions.length > 1 && (
        <>
          <Sep />
          <Group label="Source">
            <Chip
              active={filters.sourceType == null}
              onClick={() => onChange({ ...filters, sourceType: null })}
            >
              All
            </Chip>
            {sourceOptions.map((s) => (
              <Chip
                key={s}
                active={filters.sourceType === s}
                onClick={() => onChange({ ...filters, sourceType: s })}
              >
                {sourceLabel(s)}
              </Chip>
            ))}
          </Group>
        </>
      )}

      <Sep />
      <Group label="Type">
        {(
          [
            ['All', null],
            ['Binding', true],
            ['Signaling', false],
          ] as const
        ).map(([label, value]) => (
          <Chip
            key={label}
            active={filters.binding === value}
            onClick={() => onChange({ ...filters, binding: value })}
          >
            {label}
          </Chip>
        ))}
      </Group>

      <Sep />
      <Group label="Voting start">
        <input
          type="date"
          aria-label="Voting start from"
          value={fromDate(filters.startsMin)}
          onChange={(e) => onChange({ ...filters, startsMin: toDate(e.target.value) })}
          className="border border-line-3 bg-bg px-2 py-0.5 text-ink"
        />
        <span className="text-ink-4">→</span>
        <input
          type="date"
          aria-label="Voting start to"
          value={fromDate(filters.startsMax)}
          onChange={(e) => onChange({ ...filters, startsMax: toDate(e.target.value) })}
          className="border border-line-3 bg-bg px-2 py-0.5 text-ink"
        />
      </Group>

      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="ml-auto border border-line-3 px-2.5 py-0.5 text-ink-3 transition-colors hover:border-line hover:text-ink"
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
      <span className="uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'border px-2 py-0.5 uppercase tracking-[0.04em] transition-colors',
        active
          ? 'border-primary bg-primary text-paper'
          : 'border-line-3 text-ink-2 hover:border-ink-3',
      )}
    >
      {children}
    </button>
  );
}
