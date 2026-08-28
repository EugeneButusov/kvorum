import { describe, expect, it, vi } from 'vitest';
import { SearchController } from './search.controller';
import { ProblemException } from '../http/problem-exception';

function makeProposalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dao_slug: 'compound',
    dao_name: 'Compound',
    source_type: 'compound_governor_bravo',
    source_id: '42',
    title: 'Add WBTC market',
    state: 'active',
    voting_starts_at: new Date('2026-03-01T12:00:00Z'),
    rank: 0.85,
    ...overrides,
  };
}

function makeDaoRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    slug: 'aave',
    name: 'Aave',
    description: 'Aave governance',
    rank: 0.9,
    ...overrides,
  };
}

function makeActorRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    display_name: 'Alice',
    primary_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    rank: 1.0,
    ...overrides,
  };
}

describe('SearchController', () => {
  it('returns wrapped search results with all entity types', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({
        proposals: [makeProposalRow()],
        daos: [makeDaoRow()],
        actors: [makeActorRow()],
      }),
    };
    const controller = new SearchController(service as never);

    const out = await controller.search('compound', undefined, undefined);

    expect(out.data.proposals).toHaveLength(1);
    expect(out.data.proposals[0]?.dao_slug).toBe('compound');
    expect(out.data.daos).toHaveLength(1);
    expect(out.data.daos[0]?.slug).toBe('aave');
    expect(out.data.actors).toHaveLength(1);
    expect(out.data.actors[0]?.primary_address).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('converts voting_starts_at Date to ISO string', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({
        proposals: [makeProposalRow({ voting_starts_at: new Date('2026-06-15T10:00:00Z') })],
        daos: [],
        actors: [],
      }),
    };
    const controller = new SearchController(service as never);

    const out = await controller.search('test', undefined, undefined);
    expect(out.data.proposals[0]?.voting_starts_at).toBe('2026-06-15T10:00:00.000Z');
  });

  it('returns null for null voting_starts_at', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({
        proposals: [makeProposalRow({ voting_starts_at: null })],
        daos: [],
        actors: [],
      }),
    };
    const controller = new SearchController(service as never);

    const out = await controller.search('test', undefined, undefined);
    expect(out.data.proposals[0]?.voting_starts_at).toBeNull();
  });

  it('throws on missing q parameter', async () => {
    const service = { search: vi.fn() };
    const controller = new SearchController(service as never);

    await expect(controller.search(undefined, undefined, undefined)).rejects.toBeInstanceOf(
      ProblemException,
    );
    expect(service.search).not.toHaveBeenCalled();
  });

  it('throws on empty q parameter', async () => {
    const service = { search: vi.fn() };
    const controller = new SearchController(service as never);

    await expect(controller.search('   ', undefined, undefined)).rejects.toBeInstanceOf(
      ProblemException,
    );
    expect(service.search).not.toHaveBeenCalled();
  });

  it('throws on invalid type parameter', async () => {
    const service = { search: vi.fn() };
    const controller = new SearchController(service as never);

    await expect(controller.search('test', undefined, 'invalid')).rejects.toBeInstanceOf(
      ProblemException,
    );
    expect(service.search).not.toHaveBeenCalled();
  });

  it('accepts valid type parameters', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({ proposals: [], daos: [], actors: [] }),
    };
    const controller = new SearchController(service as never);

    for (const type of ['proposal', 'dao', 'actor']) {
      await controller.search('test', undefined, type);
    }

    expect(service.search).toHaveBeenCalledTimes(3);
  });

  it('parses limit string to number', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({ proposals: [], daos: [], actors: [] }),
    };
    const controller = new SearchController(service as never);

    await controller.search('test', '10', undefined);

    expect(service.search).toHaveBeenCalledWith('test', undefined, 10);
  });

  it('passes undefined limit when limit is NaN', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({ proposals: [], daos: [], actors: [] }),
    };
    const controller = new SearchController(service as never);

    await controller.search('test', 'abc', undefined);

    expect(service.search).toHaveBeenCalledWith('test', undefined, undefined);
  });

  it('passes undefined limit when limit is not provided', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({ proposals: [], daos: [], actors: [] }),
    };
    const controller = new SearchController(service as never);

    await controller.search('test', undefined, undefined);

    expect(service.search).toHaveBeenCalledWith('test', undefined, undefined);
  });

  it('forwards type to service', async () => {
    const service = {
      search: vi.fn().mockResolvedValue({ proposals: [], daos: [], actors: [] }),
    };
    const controller = new SearchController(service as never);

    await controller.search('governance', undefined, 'proposal');

    expect(service.search).toHaveBeenCalledWith('governance', 'proposal', undefined);
  });
});
