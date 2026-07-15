import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { DaoAnalyticsController } from './dao-analytics.controller';
import { ProblemException } from '../http/problem-exception';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

const baseDao = { id: 'dao-1', slug: 'test-dao' };
const baseMeta = { mirrorLastEtl: new Date('2026-01-15') };

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    passRateByBucket: vi.fn().mockResolvedValue([]),
    concentrationByBucket: vi.fn().mockResolvedValue({ rows: [], ...baseMeta }),
    findEarliestDelegationEventAt: vi.fn().mockResolvedValue(new Date('2025-01-01')),
    delegationFlowEdges: vi.fn().mockResolvedValue({ rows: [], ...baseMeta }),
    currentVotingPowerByActor: vi.fn().mockResolvedValue([]),
    findActors: vi.fn().mockResolvedValue([]),
    delegateAlignmentPage: vi.fn().mockResolvedValue({ rows: [], ...baseMeta }),
    delegateLeaderboard: vi.fn().mockResolvedValue({ rows: [], totalVotingPower: '0' }),
    ...overrides,
  };
}

describe('DaoAnalyticsController', () => {
  describe('passRate', () => {
    it('returns pass rate data for known dao', async () => {
      const repo = makeRepo({
        passRateByBucket: vi.fn().mockResolvedValue([
          {
            source_type: 'test_source_type',
            bucket: new Date('2026-01-01'),
            passed: 3,
            failed: 1,
            pass_rate: 0.75,
          },
        ]),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const routing = { resolveAddress: vi.fn() };
      const controller = new DaoAnalyticsController(
        repo as never,
        daoRepo as never,
        routing as never,
      );

      const out = await controller.passRate('test-dao', {
        bucket: 'monthly',
        from: new Date('2025-01-01'),
        to: new Date('2026-01-01'),
      } as never);
      expect(out.data).toHaveLength(1);
    });

    it('throws not-found when dao is missing', async () => {
      const repo = makeRepo();
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      await expect(controller.passRate('unknown', {} as never)).rejects.toBeInstanceOf(
        ProblemException,
      );
    });

    it('throws 400 on invalid query params', async () => {
      const repo = makeRepo();
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      await expect(
        controller.passRate('test-dao', { bucket: 'invalid-grain' } as never),
      ).rejects.toBeInstanceOf(ProblemException);
    });
  });

  describe('concentration', () => {
    it('returns concentration data', async () => {
      const repo = makeRepo({
        concentrationByBucket: vi.fn().mockResolvedValue({
          rows: [
            {
              bucket: new Date('2026-01-01'),
              weights: ['1000', '500'],
              total_voting_power: '1500',
              delegate_count: 2,
            },
          ],
          ...baseMeta,
        }),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      const out = await controller.concentration(
        'test-dao',
        {
          from: new Date('2025-06-01'),
          to: new Date('2026-01-01'),
          bucket: 'monthly',
        } as never,
        mockResponse(),
      );
      expect(out!.data).toHaveLength(1);
    });

    it('returns 204 when window has no power-bearing delegation', async () => {
      const repo = makeRepo({
        concentrationByBucket: vi.fn().mockResolvedValue({
          rows: [
            {
              bucket: new Date('2026-01-01'),
              weights: ['0', '0'],
              total_voting_power: '0',
              delegate_count: 2,
            },
          ],
          ...baseMeta,
        }),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);
      const res = mockResponse();

      const out = await controller.concentration(
        'test-dao',
        {
          from: new Date('2025-06-01'),
          to: new Date('2026-01-01'),
          bucket: 'monthly',
        } as never,
        res,
      );
      expect(out).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 204 for empty window (no rows)', async () => {
      const repo = makeRepo({
        concentrationByBucket: vi.fn().mockResolvedValue({ rows: [], ...baseMeta }),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);
      const res = mockResponse();

      const out = await controller.concentration(
        'test-dao',
        {
          from: new Date('2025-06-01'),
          to: new Date('2026-01-01'),
          bucket: 'monthly',
        } as never,
        res,
      );
      expect(out).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns all buckets unchanged when any bucket has power (no per-bucket exclusion)', async () => {
      // A source may emit events with mixed power (real power in some buckets, zero in others).
      // A window with mixed buckets must return ALL buckets; the zero-power bucket is NOT dropped.
      const repo = makeRepo({
        concentrationByBucket: vi.fn().mockResolvedValue({
          rows: [
            {
              bucket: new Date('2025-12-01'),
              weights: ['0', '0'],
              total_voting_power: '0',
              delegate_count: 2,
            },
            {
              bucket: new Date('2026-01-01'),
              weights: ['1000', '500'],
              total_voting_power: '1500',
              delegate_count: 2,
            },
          ],
          ...baseMeta,
        }),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);
      const res = mockResponse();

      const out = await controller.concentration(
        'test-dao',
        {
          from: new Date('2025-12-01'),
          to: new Date('2026-01-01'),
          bucket: 'monthly',
        } as never,
        res,
      );
      // Window has power → 200, both buckets returned
      expect(out).not.toBeUndefined();
      expect(out!.data).toHaveLength(2);
      expect(res.status).not.toHaveBeenCalledWith(204);
    });

    it('throws not-found when dao is missing', async () => {
      const repo = makeRepo();
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      await expect(
        controller.concentration('unknown', {} as never, mockResponse()),
      ).rejects.toBeInstanceOf(ProblemException);
    });

    it('throws 400 when bucket count exceeds 1000', async () => {
      const repo = makeRepo();
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      await expect(
        controller.concentration(
          'test-dao',
          {
            from: new Date('2020-01-01'),
            to: new Date('2026-01-01'),
            bucket: 'daily',
          } as never,
          mockResponse(),
        ),
      ).rejects.toBeInstanceOf(ProblemException);
    });

    it('uses findEarliestDelegationEventAt when from is absent', async () => {
      const repo = makeRepo({
        findEarliestDelegationEventAt: vi.fn().mockResolvedValue(new Date('2025-12-01')),
        concentrationByBucket: vi.fn().mockResolvedValue({ rows: [], ...baseMeta }),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);
      const res = mockResponse();

      const out = await controller.concentration(
        'test-dao',
        {
          to: new Date('2026-01-01'),
          bucket: 'monthly',
        } as never,
        res,
      );
      // No rows → 204
      expect(out).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(204);
      expect(
        (repo as ReturnType<typeof makeRepo>).findEarliestDelegationEventAt,
      ).toHaveBeenCalled();
    });

    it('uses to as from when findEarliestDelegationEventAt returns null', async () => {
      const repo = makeRepo({
        findEarliestDelegationEventAt: vi.fn().mockResolvedValue(null),
        concentrationByBucket: vi.fn().mockResolvedValue({ rows: [], ...baseMeta }),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);
      const res = mockResponse();

      const out = await controller.concentration(
        'test-dao',
        {
          to: new Date('2026-01-01'),
          bucket: 'monthly',
        } as never,
        res,
      );
      // No rows → 204
      expect(out).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('throws 400 for invalid concentration query', async () => {
      const repo = makeRepo();
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      await expect(
        controller.concentration('test-dao', { bucket: 'not-a-grain' } as never, mockResponse()),
      ).rejects.toBeInstanceOf(ProblemException);
    });
  });

  describe('delegationFlow', () => {
    it('returns delegation flow for known dao', async () => {
      const repo = makeRepo({
        delegationFlowEdges: vi.fn().mockResolvedValue({
          rows: [
            {
              delegator_actor_id: 'a1',
              delegate_actor_id: 'a2',
              voting_power: '100',
              block_number: '99',
              event_type: 'delegate_changed',
              created_at: new Date('2026-01-01'),
            },
          ],
          ...baseMeta,
        }),
        currentVotingPowerByActor: vi
          .fn()
          .mockResolvedValue([{ actor_id: 'a1', voting_power: '100' }]),
        findActors: vi
          .fn()
          .mockResolvedValue([{ id: 'a1', primary_address: '0xaaa', display_name: null }]),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      const out = await controller.delegationFlow('test-dao', {
        from: new Date('2025-10-01'),
        to: new Date('2026-01-01'),
        min_voting_power: '1000',
      } as never);
      expect(out.edges).toHaveLength(1);
    });

    it('returns empty primary_address when actor not in map (covers ?? fallback in delegation-flow.mappers)', async () => {
      const repo = makeRepo({
        delegationFlowEdges: vi.fn().mockResolvedValue({
          rows: [
            {
              delegator_actor_id: 'a1',
              delegate_actor_id: 'a2',
              voting_power: '100',
              block_number: '99',
              event_type: 'delegate_changed',
              created_at: new Date('2026-01-01'),
            },
          ],
          ...baseMeta,
        }),
        currentVotingPowerByActor: vi
          .fn()
          .mockResolvedValue([{ actor_id: 'a1', voting_power: '100' }]),
        findActors: vi.fn().mockResolvedValue([]), // empty actors → actor not in map
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      const out = await controller.delegationFlow('test-dao', {
        from: new Date('2025-10-01'),
        to: new Date('2026-01-01'),
      } as never);
      expect(out.nodes[0]?.primary_address).toBe('');
    });

    it('throws not-found when dao is missing', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        {} as never,
      );

      await expect(controller.delegationFlow('unknown', {} as never)).rejects.toBeInstanceOf(
        ProblemException,
      );
    });

    it('throws 400 for invalid delegation-flow query', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        {} as never,
      );

      await expect(
        controller.delegationFlow('test-dao', { min_voting_power: 'not-a-number' } as never),
      ).rejects.toBeInstanceOf(ProblemException);
    });
  });

  describe('delegateAlignment', () => {
    it('returns alignment for known delegate with real rows (covers delegate-alignment.mappers)', async () => {
      const repo = makeRepo({
        delegateAlignmentPage: vi.fn().mockResolvedValue({
          rows: [
            {
              peer_actor_id: 'a2',
              vote_count: 5,
              shared_proposals: 4,
              matched_choices: 3,
              alignment_score: 0.75,
            },
            {
              peer_actor_id: 'a3',
              vote_count: 2,
              shared_proposals: 0,
              matched_choices: 0,
              alignment_score: 0,
            },
            {
              peer_actor_id: 'a4',
              vote_count: 1,
              shared_proposals: 1,
              matched_choices: 1,
              alignment_score: 1,
            },
          ],
          ...baseMeta,
        }),
        findActors: vi
          .fn()
          .mockResolvedValue([{ id: 'a2', primary_address: '0xbbb', display_name: 'Bob' }]),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const routing = {
        resolveAddress: vi.fn().mockResolvedValue({
          kind: 'ok',
          actor: { id: 'a1', primary_address: '0xaaa', display_name: null },
        }),
      };
      const controller = new DaoAnalyticsController(
        repo as never,
        daoRepo as never,
        routing as never,
      );

      const out = await controller.delegateAlignment(
        'test-dao',
        {
          delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sort: '-vote_count',
          limit: '2',
        } as never,
        mockResponse(),
      );
      // With limit=2 and 3 rows, hasMore=true, page.data has first 2 rows: a2 (found) and a3 (not found → '' address)
      expect(out?.peers).toHaveLength(2);
      expect(out?.peers[0]?.address).toBe('0xbbb');
      expect(out?.peers[1]?.address).toBe('');
      expect(out?.pagination.next_cursor).not.toBeNull();
    });

    it('returns alignment sorted by alignment_score asc', async () => {
      const repo = makeRepo({
        delegateAlignmentPage: vi.fn().mockResolvedValue({ rows: [], ...baseMeta }),
        findActors: vi.fn().mockResolvedValue([]),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const routing = {
        resolveAddress: vi.fn().mockResolvedValue({
          kind: 'ok',
          actor: { id: 'a1', primary_address: '0xaaa', display_name: null },
        }),
      };
      const controller = new DaoAnalyticsController(
        repo as never,
        daoRepo as never,
        routing as never,
      );

      const out = await controller.delegateAlignment(
        'test-dao',
        {
          delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sort: 'alignment_score',
        } as never,
        mockResponse(),
      );
      expect(out?.peers).toHaveLength(0);
    });

    it('throws not-found when dao is missing', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        {} as never,
      );

      await expect(
        controller.delegateAlignment(
          'unknown',
          { delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } as never,
          mockResponse(),
        ),
      ).rejects.toBeInstanceOf(ProblemException);
    });

    it('throws 400 for invalid delegate alignment query', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        {} as never,
      );

      await expect(
        controller.delegateAlignment(
          'test-dao',
          { delegate: 'not-an-address' } as never,
          mockResponse(),
        ),
      ).rejects.toBeInstanceOf(ProblemException);
    });

    it('throws 400 when from > to in delegate-alignment query (covers refine branch)', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        {} as never,
      );

      await expect(
        controller.delegateAlignment(
          'test-dao',
          {
            delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            from: '2026-02-01',
            to: '2026-01-01',
          } as never,
          mockResponse(),
        ),
      ).rejects.toBeInstanceOf(ProblemException);
    });

    it('redirects for merged delegate address', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const routing = {
        resolveAddress: vi.fn().mockResolvedValue({
          kind: 'redirect',
          survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        }),
      };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        routing as never,
      );
      const res = mockResponse();

      const out = await controller.delegateAlignment(
        'test-dao',
        {
          delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        } as never,
        res,
      );
      expect(out).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(301);
    });

    it('throws actor-not-found for unknown delegate address', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const routing = {
        resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }),
      };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        routing as never,
      );

      await expect(
        controller.delegateAlignment(
          'test-dao',
          {
            delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          } as never,
          mockResponse(),
        ),
      ).rejects.toBeInstanceOf(ProblemException);
    });

    it('throws 400 when cursor does not match query', async () => {
      const { encodeCursor } = await import('../pagination/cursor');
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const routing = {
        resolveAddress: vi.fn().mockResolvedValue({
          kind: 'ok',
          actor: { id: 'a1', primary_address: '0xaaa', display_name: null },
        }),
      };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        routing as never,
      );
      const mismatchCursor = encodeCursor({
        type: 'numeric',
        value: 5,
        tiebreak: 'x',
        dir: 'desc',
        q: 'wrong-q',
      });

      await expect(
        controller.delegateAlignment(
          'test-dao',
          {
            delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            cursor: mismatchCursor,
          } as never,
          mockResponse(),
        ),
      ).rejects.toBeInstanceOf(ProblemException);
    });
  });

  describe('delegateLeaderboard', () => {
    it('returns ranked delegates with share, identity, and the missing-actor fallback', async () => {
      const repo = makeRepo({
        delegateLeaderboard: vi.fn().mockResolvedValue({
          rows: [
            { actor_id: 'a1', voting_power: '150', delegator_count: 2 },
            { actor_id: 'a2', voting_power: '50', delegator_count: 1 },
          ],
          totalVotingPower: '200',
        }),
        // a2 intentionally absent → exercises the actor-not-in-map ('' address) fallback.
        findActors: vi
          .fn()
          .mockResolvedValue([{ id: 'a1', primary_address: '0xaaa', display_name: 'a16z' }]),
      });
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(repo as never, daoRepo as never, {} as never);

      const out = await controller.delegateLeaderboard('test-dao', { limit: '25' } as never);
      expect(out.data).toHaveLength(2);
      expect(out.data[0]).toMatchObject({
        rank: 1,
        address: '0xaaa',
        display_name: 'a16z',
        voting_power_share: 0.75,
        delegator_count: 2,
      });
      expect(out.data[1]).toMatchObject({ rank: 2, address: '', voting_power_share: 0.25 });
    });

    it('throws not-found when dao is missing', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        {} as never,
      );

      await expect(controller.delegateLeaderboard('unknown', {} as never)).rejects.toBeInstanceOf(
        ProblemException,
      );
    });

    it('throws 400 for an out-of-range limit', async () => {
      const daoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(baseDao) };
      const controller = new DaoAnalyticsController(
        makeRepo() as never,
        daoRepo as never,
        {} as never,
      );

      await expect(
        controller.delegateLeaderboard('test-dao', { limit: '0' } as never),
      ).rejects.toBeInstanceOf(ProblemException);
    });
  });
});
