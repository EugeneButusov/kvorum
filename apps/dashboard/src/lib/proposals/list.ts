// Proposals-list state (§6.5 cross-DAO, §6.8 DAO-scoped): the filter + sort model, its URL encoding
// (shareable per §6.5), and the paged fetch. Server-supported filters only — has-mismatch/has-forum
// and vote-count/VP sorts aren't in the list API, so they're not offered.

import type { createApiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

type RawListItem = components['schemas']['ProposalListItemDto'];

/** The runtime shape of an untyped-nullable field the generator typed as `{}`. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export const SORT_FIELDS = [
  'voting_ends_at',
  'voting_starts_at',
  'created_at',
  'state_updated_at',
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_LABELS: Record<SortField, string> = {
  voting_ends_at: 'Voting close',
  voting_starts_at: 'Voting start',
  created_at: 'Created',
  state_updated_at: 'Last activity',
};

export type ProposalSort = { field: SortField; dir: 'asc' | 'desc' };

export type ProposalFilters = {
  /** Cross-DAO only; empty = all DAOs. */
  dao: string[];
  state: string[];
  binding: boolean | null;
  startsMin: string | null;
  startsMax: string | null;
};

// §6.5: state defaults to the proposals that are or recently were live.
export const DEFAULT_STATES = ['active', 'succeeded', 'executed'];
export const DEFAULT_SORT: ProposalSort = { field: 'voting_ends_at', dir: 'desc' };

export const EMPTY_FILTERS: ProposalFilters = {
  dao: [],
  state: DEFAULT_STATES,
  binding: null,
  startsMin: null,
  startsMax: null,
};

function splitCsv(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

/** Turn a Next.js `searchParams` record into `URLSearchParams` for `parseListParams`. */
export function paramsFromRecord(
  record: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') p.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === 'string') p.set(key, value[0]);
  }
  return p;
}

/** Read filter + sort state from a URL query string (client `URLSearchParams` or server params). */
export function parseListParams(params: URLSearchParams): {
  filters: ProposalFilters;
  sort: ProposalSort;
} {
  const rawSort = params.get('sort');
  const sort = parseSort(rawSort);
  const bindingRaw = params.get('binding');
  return {
    sort,
    filters: {
      dao: splitCsv(params.get('dao')),
      state: params.has('state') ? splitCsv(params.get('state')) : DEFAULT_STATES,
      binding: bindingRaw === 'true' ? true : bindingRaw === 'false' ? false : null,
      startsMin: params.get('starts_min') || null,
      startsMax: params.get('starts_max') || null,
    },
  };
}

function parseSort(raw: string | null): ProposalSort {
  if (!raw) return DEFAULT_SORT;
  const dir = raw.startsWith('-') ? 'desc' : 'asc';
  const field = (dir === 'desc' ? raw.slice(1) : raw) as SortField;
  return SORT_FIELDS.includes(field) ? { field, dir } : DEFAULT_SORT;
}

export function sortToParam(sort: ProposalSort): string {
  return `${sort.dir === 'desc' ? '-' : ''}${sort.field}`;
}

/** Encode filter + sort back into a query string; defaults are omitted to keep URLs clean. */
export function toSearchParams(filters: ProposalFilters, sort: ProposalSort): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.dao.length) p.set('dao', filters.dao.join(','));
  if (!isDefaultStates(filters.state)) p.set('state', filters.state.join(','));
  if (filters.binding != null) p.set('binding', String(filters.binding));
  if (filters.startsMin) p.set('starts_min', filters.startsMin);
  if (filters.startsMax) p.set('starts_max', filters.startsMax);
  if (sort.field !== DEFAULT_SORT.field || sort.dir !== DEFAULT_SORT.dir) {
    p.set('sort', sortToParam(sort));
  }
  return p;
}

function isDefaultStates(state: string[]): boolean {
  return state.length === DEFAULT_STATES.length && DEFAULT_STATES.every((s) => state.includes(s));
}

export type ProposalListItemView = {
  daoSlug: string;
  sourceType: string;
  sourceId: string;
  title: string | null;
  state: string;
  binding: boolean;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  proposer: { address: string; displayName: string | null };
  href: string;
};

export function normalizeListItem(dto: RawListItem): ProposalListItemView {
  return {
    daoSlug: dto.dao_slug,
    sourceType: dto.source_type,
    sourceId: dto.source_id,
    title: asString(dto.title),
    state: dto.state,
    binding: dto.binding,
    votingStartsAt: asString(dto.voting_starts_at),
    votingEndsAt: asString(dto.voting_ends_at),
    proposer: { address: dto.proposer.address, displayName: asString(dto.proposer.display_name) },
    href: `/daos/${dto.dao_slug}/proposals/${dto.source_type}/${dto.source_id}`,
  };
}

export const PAGE_SIZE = 50;

export type ProposalPage = { items: ProposalListItemView[]; nextCursor: string | null };

export type FetchProposalsArgs = {
  /** When set, hits the DAO-scoped endpoint; otherwise the cross-DAO one. */
  slug?: string;
  filters: ProposalFilters;
  sort: ProposalSort;
  cursor?: string;
};

/** Build the API query for a page — only the filters each endpoint actually supports. */
function buildQuery(args: FetchProposalsArgs): Record<string, string | number | boolean> {
  const { filters, sort, cursor, slug } = args;
  const q: Record<string, string | number | boolean> = {
    limit: PAGE_SIZE,
    sort: sortToParam(sort),
  };
  if (cursor) q.cursor = cursor;
  if (filters.state.length) q.state = filters.state.join(',');
  if (filters.binding != null) q.binding = filters.binding;
  if (filters.startsMin) q.voting_starts_at_min = filters.startsMin;
  if (filters.startsMax) q.voting_starts_at_max = filters.startsMax;
  // Cross-DAO takes the DAO multi-select; DAO-scoped is already narrowed by its path.
  if (!slug && filters.dao.length) q.dao = filters.dao.join(',');
  return q;
}

export async function fetchProposalPage(
  api: ReturnType<typeof createApiClient>,
  args: FetchProposalsArgs,
): Promise<ProposalPage> {
  const query = buildQuery(args);
  const { data, error } = args.slug
    ? await api.GET('/v1/daos/{slug}/proposals', {
        params: { path: { slug: args.slug }, query },
      })
    : await api.GET('/v1/proposals', { params: { query } });
  if (error) throw error;

  const nextCursor = (data.pagination.next_cursor as string | null) ?? null;
  return {
    items: data.data.map(normalizeListItem),
    nextCursor: data.pagination.has_more ? nextCursor : null,
  };
}
