'use client';

import type { ProposalFilters } from '@/lib/proposals/list';
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

/** Filter sidebar (§6.5 / §6.8). All state is lifted to the list, which mirrors it into the URL. */
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
    <div className="flex flex-col gap-6 font-mono text-caption">
      <h2 className="text-body font-semibold text-ink">Filters</h2>

      {scope === 'cross' && daoOptions.length > 0 && (
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
      )}

      <Group label="State">
        {STATE_OPTIONS.map((s) => (
          <Chip key={s} active={filters.state.includes(s)} onClick={() => toggleIn('state', s)}>
            {s}
          </Chip>
        ))}
      </Group>

      {scope === 'dao' && sourceOptions.length > 1 && (
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
      )}

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

      <Group label="Voting start">
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-2 text-ink-3">
            From
            <input
              type="date"
              value={fromDate(filters.startsMin)}
              onChange={(e) => onChange({ ...filters, startsMin: toDate(e.target.value) })}
              className="border border-line-3 bg-bg-2 px-2 py-1 text-ink"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-ink-3">
            To
            <input
              type="date"
              value={fromDate(filters.startsMax)}
              onChange={(e) => onChange({ ...filters, startsMax: toDate(e.target.value) })}
              className="border border-line-3 bg-bg-2 px-2 py-1 text-ink"
            />
          </label>
        </div>
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="uppercase tracking-[0.06em] text-ink-4">{label}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
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
          ? 'border-primary bg-primary text-bg-2'
          : 'border-line-3 text-ink-2 hover:border-ink-3',
      )}
    >
      {children}
    </button>
  );
}
