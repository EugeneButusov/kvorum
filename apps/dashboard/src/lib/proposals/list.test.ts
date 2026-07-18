import { vi } from 'vitest';

import {
  DEFAULT_SORT,
  DEFAULT_STATES,
  fetchProposalPage,
  normalizeListItem,
  paramsFromRecord,
  parseListParams,
  toSearchParams,
  type ProposalFilters,
  type ProposalSort,
} from './list';

describe('parseListParams', () => {
  it('applies default states and sort when nothing is set', () => {
    const { filters, sort } = parseListParams(new URLSearchParams());
    expect(filters.state).toEqual(DEFAULT_STATES);
    expect(filters.dao).toEqual([]);
    expect(sort).toEqual(DEFAULT_SORT);
  });

  it('reads the DAO multi-select, state, and sort', () => {
    const { filters, sort } = parseListParams(
      new URLSearchParams('dao=lido,uniswap&state=active&sort=created_at'),
    );
    expect(filters.dao).toEqual(['lido', 'uniswap']);
    expect(filters.state).toEqual(['active']);
    expect(sort).toEqual({ field: 'created_at', dir: 'asc' });
  });

  it('ignores retired filter params from a stale link', () => {
    const { filters } = parseListParams(
      new URLSearchParams('state=active&source=snapshot&binding=false&starts_min=2026-01-01'),
    );
    expect(filters).toEqual({ dao: [], state: ['active'] });
  });

  it('parses a descending sort and rejects an unknown field', () => {
    expect(parseListParams(new URLSearchParams('sort=-voting_ends_at')).sort).toEqual({
      field: 'voting_ends_at',
      dir: 'desc',
    });
    expect(parseListParams(new URLSearchParams('sort=bogus')).sort).toEqual(DEFAULT_SORT);
  });
});

describe('toSearchParams', () => {
  const base: ProposalFilters = {
    dao: [],
    state: DEFAULT_STATES,
  };

  it('omits defaults so a pristine view has a clean URL', () => {
    expect(toSearchParams(base, DEFAULT_SORT).toString()).toBe('');
  });

  it('round-trips a non-trivial filter+sort through the URL', () => {
    const filters: ProposalFilters = {
      dao: ['lido'],
      state: ['active', 'defeated'],
    };
    const sort: ProposalSort = { field: 'created_at', dir: 'asc' };
    const round = parseListParams(new URLSearchParams(toSearchParams(filters, sort).toString()));
    expect(round.filters).toEqual(filters);
    expect(round.sort).toEqual(sort);
  });
});

describe('paramsFromRecord', () => {
  it('coerces Next searchParams (string | string[]) to URLSearchParams', () => {
    const p = paramsFromRecord({ dao: 'lido', state: ['active', 'ignored'], missing: undefined });
    expect(p.get('dao')).toBe('lido');
    expect(p.get('state')).toBe('active');
    expect(p.has('missing')).toBe(false);
  });
});

describe('fetchProposalPage', () => {
  const filters: ProposalFilters = {
    dao: ['lido', 'uniswap'],
    state: ['active'],
  };
  const sort: ProposalSort = { field: 'voting_ends_at', dir: 'desc' };
  const page = { data: [], pagination: { has_more: false, next_cursor: null } };

  it('cross-DAO: hits /v1/proposals with the DAO multi-select', async () => {
    const GET = vi.fn().mockResolvedValue({ data: page, error: null });
    await fetchProposalPage({ GET } as never, { filters, sort });
    expect(GET).toHaveBeenCalledWith('/v1/proposals', expect.anything());
    const query = GET.mock.calls[0]![1].params.query;
    expect(query.dao).toBe('lido,uniswap');
    expect(query.sort).toBe('-voting_ends_at');
    expect(query.state).toBe('active');
  });

  it('DAO-scoped: hits the scoped endpoint, which its path already narrows', async () => {
    const GET = vi.fn().mockResolvedValue({ data: page, error: null });
    await fetchProposalPage({ GET } as never, { slug: 'lido', filters, sort });
    expect(GET).toHaveBeenCalledWith('/v1/daos/{slug}/proposals', expect.anything());
    const query = GET.mock.calls[0]![1].params.query;
    expect(query.dao).toBeUndefined();
  });

  it('drops the trailing cursor when there are no more pages', async () => {
    const GET = vi.fn().mockResolvedValue({
      data: { data: [], pagination: { has_more: false, next_cursor: 'c1' } },
      error: null,
    });
    const result = await fetchProposalPage({ GET } as never, { filters, sort });
    expect(result.nextCursor).toBeNull();
  });
});

describe('normalizeListItem', () => {
  it('coerces the generator-mistyped nullable fields and builds the detail href', () => {
    const view = normalizeListItem({
      dao_slug: 'lido',
      source_type: 'snapshot',
      source_id: '0xabc',
      title: 'Fund it',
      state: 'active',
      binding: false,
      voting_starts_at: '2026-07-01T00:00:00Z',
      voting_ends_at: null,
      proposer: { address: '0xProposer', display_name: null },
      _meta: { confirmed: true, last_updated_at: '', links: { self: '', votes: '' } },
    } as never);
    expect(view.title).toBe('Fund it');
    expect(view.votingEndsAt).toBeNull();
    expect(view.href).toBe('/daos/lido/proposals/snapshot/0xabc');
  });
});
