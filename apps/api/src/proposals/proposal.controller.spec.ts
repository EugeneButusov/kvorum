import { describe, expect, it, vi } from 'vitest';
import type { SourceApiRegistry } from '@nest/source-api';
import { ProposalController } from './proposal.controller';
import { ProblemException } from '../http/problem-exception';

function makeRegistry(overrides?: Partial<SourceApiRegistry>): SourceApiRegistry {
  return {
    choiceBounds: vi.fn().mockReturnValue({ min: 0, max: 2 }),
    getProposalExtension: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as SourceApiRegistry;
}

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

const baseProposalRow = {
  id: 'p1',
  dao_slug: 'compound',
  source_type: 'compound_governor_bravo',
  source_id: '42',
  title: 'Test Proposal',
  description: 'desc',
  description_hash: 'a'.repeat(64),
  state: 'active',
  binding: true,
  voting_starts_at: new Date('2026-01-01'),
  voting_ends_at: new Date('2026-02-01'),
  voting_starts_block: '1',
  voting_ends_block: '2',
  state_updated_at: new Date('2026-01-01'),
  created_at: new Date('2025-12-31'),
  proposer_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  proposer_display_name: null,
};

const baseDao = { id: 'dao-1', slug: 'compound' };

describe('ProposalController', () => {
  describe('listByDao', () => {
    it('returns proposal list for known dao', async () => {
      const qb = makeQb([baseProposalRow]);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {} as never);
      expect(out.data).toHaveLength(1);
    });

    it('throws not-found when dao is missing', async () => {
      const repo = { listBaseQuery: vi.fn() };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      await expect(controller.listByDao('unknown', {} as never)).rejects.toBeInstanceOf(
        ProblemException,
      );
    });

    it('passes cursor through assertCursorMatchesQuery in listByDao', async () => {
      const qb = makeQb([]);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const { canonicalQuery, encodeCursor } = await import('../pagination/cursor');
      const { parseQuery } = await import('../query/query-parser');
      const { PER_DAO_PROPOSAL_QUERY } = await import('./proposal.query');

      const canonical = canonicalQuery(parseQuery({}, PER_DAO_PROPOSAL_QUERY));
      const cursorStr = encodeCursor({
        type: 'time',
        value: '2026-01-01T00:00:00.000Z',
        tiebreak: 'p0',
        dir: 'desc',
        q: canonical,
      });

      const out = await controller.listByDao('compound', { cursor: cursorStr } as never);
      expect(out.data).toHaveLength(0);
    });

    it('paginates with hasMore=true using voting_starts_at sort (null → infinity)', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1', voting_starts_at: null },
        { ...baseProposalRow, id: 'p2', voting_starts_at: null },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: 'voting_starts_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('paginates with voting_ends_at sort (null + desc → -infinity)', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1', voting_ends_at: null },
        { ...baseProposalRow, id: 'p2', voting_ends_at: null },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: '-voting_ends_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('paginates with non-null voting_starts_at (covers isoString branch)', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1', voting_starts_at: new Date('2026-03-01') },
        { ...baseProposalRow, id: 'p2', voting_starts_at: new Date('2026-03-02') },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: '-voting_starts_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('uses state_updated_at sort field', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1' },
        { ...baseProposalRow, id: 'p2' },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: '-state_updated_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('uses -voting_starts_at sort with null (desc → -infinity)', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1', voting_starts_at: null },
        { ...baseProposalRow, id: 'p2', voting_starts_at: null },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: '-voting_starts_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('uses voting_ends_at sort with null + asc (infinity)', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1', voting_ends_at: null },
        { ...baseProposalRow, id: 'p2', voting_ends_at: null },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: 'voting_ends_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('uses voting_ends_at sort with non-null value (iso string)', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1', voting_ends_at: new Date('2026-03-01') },
        { ...baseProposalRow, id: 'p2', voting_ends_at: new Date('2026-03-02') },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: '-voting_ends_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });
  });

  describe('detail', () => {
    it('returns Compound proposal detail without voting/payloads', async () => {
      const repo = {
        findOne: vi.fn().mockResolvedValue(baseProposalRow),
        findActions: vi.fn().mockResolvedValue([]),
        findChoices: vi.fn().mockResolvedValue([]),
        resolveOriginChainId: vi.fn().mockResolvedValue('0x1'),
      };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const registry = makeRegistry({ getProposalExtension: vi.fn().mockResolvedValue(null) });
      const controller = new ProposalController(repo as never, daoRepo as never, registry);

      const out = await controller.detail('compound', 'compound_governor_bravo', '42');
      expect(out.data.source_id).toBe('42');
      expect(out.data.origin_chain_id).toBe('0x1');
      expect((out.data as Record<string, unknown>)['voting']).toBeUndefined();
      expect((out.data as Record<string, unknown>)['payloads']).toBeUndefined();
    });

    it('returns Aave proposal detail with voting and grouped payloads', async () => {
      const aaveRow = { ...baseProposalRow, source_type: 'aave_governance_v3' };
      const extension = {
        voting: {
          voting_chain_id: '0x89',
          voting_machine_address: '0xmachine',
          voting_strategy_address: null,
          creation_block: '100',
        },
        payloads: [
          {
            payload_index: 0,
            target_chain_id: '0x1',
            payloads_controller_address: '0xctrl',
            payload_id: '1',
            status: 'executed',
            executed_at_destination: '2026-01-01T00:00:00Z',
            unindexed_target_chain: false,
          },
          {
            payload_index: 1,
            target_chain_id: '0x89',
            payloads_controller_address: '0xctrl2',
            payload_id: '2',
            status: 'queued',
            executed_at_destination: null,
            unindexed_target_chain: false,
          },
          {
            payload_index: 2,
            target_chain_id: '0x1',
            payloads_controller_address: '0xctrl',
            payload_id: '3',
            status: 'created',
            executed_at_destination: null,
            unindexed_target_chain: false,
          },
        ],
      };
      const repo = {
        findOne: vi.fn().mockResolvedValue(aaveRow),
        findActions: vi.fn().mockResolvedValue([]),
        findChoices: vi.fn().mockResolvedValue([]),
        resolveOriginChainId: vi.fn().mockResolvedValue('0x1'),
      };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const registry = makeRegistry({
        getProposalExtension: vi.fn().mockResolvedValue(extension),
      });
      const controller = new ProposalController(repo as never, daoRepo as never, registry);

      const out = await controller.detail('aave', 'aave_governance_v3', '42');
      expect(out.data.origin_chain_id).toBe('0x1');
      expect(out.data.voting).toEqual(extension.voting);
      const groups = out.data.payloads;
      expect(groups).toBeDefined();
      expect(groups).toHaveLength(2);
      const group1 = groups?.find((g) => g.target_chain_id === '0x1');
      expect(group1?.payloads).toHaveLength(2);
      const group2 = groups?.find((g) => g.target_chain_id === '0x89');
      expect(group2?.payloads).toHaveLength(1);
    });

    it('throws not-found when proposal is missing', async () => {
      const repo = { findOne: vi.fn().mockResolvedValue(undefined) };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      await expect(controller.detail('compound', 'comp', '999')).rejects.toBeInstanceOf(
        ProblemException,
      );
    });
  });

  describe('listCrossDao', () => {
    it('returns cross-dao proposal list', async () => {
      const rows = [
        { ...baseProposalRow, id: 'p1' },
        { ...baseProposalRow, id: 'p2' },
      ];
      const qb = makeQb(rows);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const out = await controller.listCrossDao({ limit: '1' } as never);
      expect(out.data).toHaveLength(1);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('passes cursor through assertCursorMatchesQuery in listCrossDao', async () => {
      const qb = makeQb([]);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const controller = new ProposalController(repo as never, daoRepo as never, makeRegistry());

      const { canonicalQuery, encodeCursor } = await import('../pagination/cursor');
      const { parseQuery } = await import('../query/query-parser');
      const { CROSS_DAO_PROPOSAL_QUERY } = await import('./proposal.query');

      const canonical = canonicalQuery(parseQuery({}, CROSS_DAO_PROPOSAL_QUERY));
      const cursorStr = encodeCursor({
        type: 'time',
        value: '2026-01-01T00:00:00.000Z',
        tiebreak: 'p0',
        dir: 'desc',
        q: canonical,
      });

      const out = await controller.listCrossDao({ cursor: cursorStr } as never);
      expect(out.data).toHaveLength(0);
    });
  });
});
