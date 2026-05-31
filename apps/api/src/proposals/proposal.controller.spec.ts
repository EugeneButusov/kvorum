import { describe, expect, it, vi } from 'vitest';
import { ProposalController } from './proposal.controller';
import { ProblemException } from '../http/problem-exception';

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
  voting_power_block: '1',
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
      const controller = new ProposalController(repo as never, daoRepo as never);

      const out = await controller.listByDao('compound', {} as never);
      expect(out.data).toHaveLength(1);
    });

    it('throws not-found when dao is missing', async () => {
      const repo = { listBaseQuery: vi.fn() };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
      const controller = new ProposalController(repo as never, daoRepo as never);

      await expect(controller.listByDao('unknown', {} as never)).rejects.toBeInstanceOf(
        ProblemException,
      );
    });

    it('passes cursor through assertCursorMatchesQuery in listByDao', async () => {
      const qb = makeQb([]);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

      const out = await controller.listByDao('compound', {
        limit: '1',
        sort: '-voting_ends_at',
      } as never);
      expect(out.pagination.next_cursor).not.toBeNull();
    });
  });

  describe('detail', () => {
    it('returns proposal detail', async () => {
      const repo = {
        findOne: vi.fn().mockResolvedValue(baseProposalRow),
        findActions: vi.fn().mockResolvedValue([]),
        findChoices: vi.fn().mockResolvedValue([]),
      };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const controller = new ProposalController(repo as never, daoRepo as never);

      const out = await controller.detail('compound', 'compound_governor_bravo', '42');
      expect(out.data.source_id).toBe('42');
    });

    it('throws not-found when proposal is missing', async () => {
      const repo = { findOne: vi.fn().mockResolvedValue(undefined) };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const controller = new ProposalController(repo as never, daoRepo as never);

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
      const controller = new ProposalController(repo as never, daoRepo as never);

      const out = await controller.listCrossDao({ limit: '1' } as never);
      expect(out.data).toHaveLength(1);
      expect(out.pagination.next_cursor).not.toBeNull();
    });

    it('passes cursor through assertCursorMatchesQuery in listCrossDao', async () => {
      const qb = makeQb([]);
      const repo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
      const daoRepo = { findDaoBySlug: vi.fn() };
      const controller = new ProposalController(repo as never, daoRepo as never);

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
