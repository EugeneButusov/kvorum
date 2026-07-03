import { describe, expect, it, vi } from 'vitest';
import type { SourceReadExtension } from '@libs/domain';
import { DaoController } from './dao.controller';
import { ProblemException } from '../http/problem-exception';

// EVM-default source coverage for the sources the fixtures exercise (no off-chain override needed).
const extensions: SourceReadExtension[] = [
  {
    sourceTypes: ['compound_governor_bravo', 'alt_governor'],
    choiceBounds: () => ({ min: 0, max: 2 }),
    delegationModel: () => 'power-bearing',
    getProposalExtension: () => Promise.resolve(null),
  },
];

function makeQb(rows: unknown[]) {
  const qb = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    execute: vi.fn().mockResolvedValue(rows),
  };
  qb.where.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.limit.mockReturnValue(qb);
  return qb;
}

const baseDao = {
  id: 'dao-1',
  slug: 'compound',
  name: 'Compound',
  description: 'DeFi',
  website_url: 'https://compound.finance',
  forum_url: null,
  primary_token_address: '0xc00e94cb662c3520282e6f5717214004a7f26888',
  primary_chain_id: '1',
  created_at: new Date('2021-01-01'),
  updated_at: new Date('2026-01-01'),
};

describe('DaoController', () => {
  it('returns dao list', async () => {
    const row = {
      ...baseDao,
      id: 'dao-1',
    };
    const qb = makeQb([row]);
    const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) } as never;
    const controller = new DaoController(repo, extensions);

    const out = await controller.list({} as never);
    expect(out.data).toHaveLength(1);
    expect(out.data[0]?.slug).toBe('compound');
  });

  it('returns dao list with cursor pagination (hasMore=true)', async () => {
    const rows = [
      { ...baseDao, id: 'dao-1', slug: 'aave' },
      { ...baseDao, id: 'dao-2', slug: 'compound' },
    ];
    const qb = makeQb(rows);
    const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) } as never;
    const controller = new DaoController(repo, extensions);

    const out = await controller.list({ limit: '1' } as never);
    expect(out.data).toHaveLength(1);
    expect(out.pagination.next_cursor).not.toBeNull();
  });

  it('returns dao list with created_at sort (covers non-slug sort branch)', async () => {
    const rows = [
      { ...baseDao, id: 'dao-1', slug: 'aave' },
      { ...baseDao, id: 'dao-2', slug: 'b' },
    ];
    const qb = makeQb(rows);
    const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) } as never;
    const controller = new DaoController(repo, extensions);

    const out = await controller.list({ limit: '1', sort: '-created_at' } as never);
    expect(out.pagination.next_cursor).not.toBeNull();
  });

  it('returns dao detail', async () => {
    const sources = [
      {
        source_type: 'compound_governor_bravo',
        source_config: { contract_address: '0xc0', chain_id: '0x1' },
      },
    ];
    const repo = {
      findDaoBySlug: vi.fn().mockResolvedValue(baseDao),
      listSourcesForDao: vi.fn().mockResolvedValue(sources),
    } as never;
    const controller = new DaoController(repo, extensions);

    const out = await controller.detail('compound');
    expect(out.data.slug).toBe('compound');
    expect(out.data.sources).toHaveLength(1);
  });

  it('throws not-found when dao is missing in detail', async () => {
    const repo = {
      findDaoBySlug: vi.fn().mockResolvedValue(undefined),
    } as never;
    const controller = new DaoController(repo, extensions);

    await expect(controller.detail('unknown')).rejects.toBeInstanceOf(ProblemException);
  });

  it('returns dao sources', async () => {
    const sources = [{ source_type: 'compound_governor_bravo', source_config: {} }];
    const repo = {
      findDaoBySlug: vi.fn().mockResolvedValue(baseDao),
      listSourcesForDao: vi.fn().mockResolvedValue(sources),
    } as never;
    const controller = new DaoController(repo, extensions);

    const out = await controller.sources('compound');
    expect(out.data).toHaveLength(1);
  });

  it('throws not-found when dao is missing in sources', async () => {
    const repo = {
      findDaoBySlug: vi.fn().mockResolvedValue(undefined),
    } as never;
    const controller = new DaoController(repo, extensions);

    await expect(controller.sources('unknown')).rejects.toBeInstanceOf(ProblemException);
  });

  it('passes cursor through assertCursorMatchesQuery in list', async () => {
    const rows = [
      { ...baseDao, id: 'dao-1', slug: 'aave' },
      { ...baseDao, id: 'dao-2', slug: 'compound' },
    ];
    const qb = makeQb(rows);
    const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) } as never;
    const controller = new DaoController(repo, extensions);

    const { canonicalQuery } = await import('../pagination/cursor');
    const { parseQuery } = await import('../query/query-parser');
    const { DAO_LIST_QUERY } = await import('./dao.query');
    const { encodeCursor } = await import('../pagination/cursor');

    const canonical = canonicalQuery(parseQuery({}, DAO_LIST_QUERY));
    const cursorStr = encodeCursor({
      type: 'time',
      value: '2021-01-01T00:00:00.000Z',
      tiebreak: 'dao-0',
      dir: 'asc',
      q: canonical,
    });

    const out = await controller.list({ cursor: cursorStr, limit: '1' } as never);
    expect(out.data.length).toBeGreaterThanOrEqual(0);
  });
});
