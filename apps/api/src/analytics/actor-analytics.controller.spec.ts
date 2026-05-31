import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ActorAnalyticsController } from './actor-analytics.controller';
import { ProblemException } from '../http/problem-exception';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

const baseActor = {
  id: 'a1',
  primary_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  display_name: 'Alice',
};

describe('ActorAnalyticsController', () => {
  it('returns cross-dao summary for resolved actor (rows present)', async () => {
    const rows = [
      {
        dao_id: 'dao-1',
        dao_slug: 'compound',
        votes_cast: 5,
        last_active_at: new Date('2026-01-01'),
      },
    ];
    const repo = {
      crossDaoSummaryForActor: vi
        .fn()
        .mockResolvedValue({ rows, mirrorLastEtl: new Date('2026-01-15') }),
      alignmentWithMajorityForActor: vi
        .fn()
        .mockResolvedValue(new Map([['dao-1', { matches: 3, denom: 5 }]])),
      findGlobalEtlWatermark: vi.fn(),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: baseActor }),
    };
    const controller = new ActorAnalyticsController(repo as never, routing as never);

    const out = await controller.crossDao(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mockResponse(),
    );

    expect(out?.address).toBe(baseActor.primary_address);
    expect(out?.daos).toHaveLength(1);
    expect(repo.findGlobalEtlWatermark).not.toHaveBeenCalled();
  });

  it('uses global etl watermark when no summaries (empty rows path)', async () => {
    const repo = {
      crossDaoSummaryForActor: vi.fn().mockResolvedValue({ rows: [], mirrorLastEtl: null }),
      alignmentWithMajorityForActor: vi.fn().mockResolvedValue(new Map()),
      findGlobalEtlWatermark: vi.fn().mockResolvedValue(new Date('2026-01-10')),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: baseActor }),
    };
    const controller = new ActorAnalyticsController(repo as never, routing as never);

    const out = await controller.crossDao(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mockResponse(),
    );

    expect(out?.daos).toHaveLength(0);
    expect(repo.findGlobalEtlWatermark).toHaveBeenCalled();
  });

  it('returns null alignment_pct when denom is zero (covers cross-dao mapper zero-denom branch)', async () => {
    const rows = [
      {
        dao_id: 'dao-1',
        dao_slug: 'compound',
        votes_cast: 3,
        last_active_at: new Date('2026-01-01'),
      },
    ];
    const repo = {
      crossDaoSummaryForActor: vi
        .fn()
        .mockResolvedValue({ rows, mirrorLastEtl: new Date('2026-01-15') }),
      alignmentWithMajorityForActor: vi
        .fn()
        .mockResolvedValue(new Map([['dao-1', { matches: 0, denom: 0 }]])),
      findGlobalEtlWatermark: vi.fn(),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: baseActor }),
    };
    const controller = new ActorAnalyticsController(repo as never, routing as never);

    const out = await controller.crossDao(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mockResponse(),
    );

    expect(out?.daos[0]?.alignment_with_majority_pct).toBeNull();
  });

  it('redirects to canonical address', async () => {
    const repo = {
      crossDaoSummaryForActor: vi.fn(),
      alignmentWithMajorityForActor: vi.fn(),
      findGlobalEtlWatermark: vi.fn(),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'redirect',
        survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    };
    const controller = new ActorAnalyticsController(repo as never, routing as never);
    const res = mockResponse();

    const out = await controller.crossDao('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', res);

    expect(out).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(301);
  });

  it('throws actor-not-found for unknown address', async () => {
    const repo = {
      crossDaoSummaryForActor: vi.fn(),
      alignmentWithMajorityForActor: vi.fn(),
      findGlobalEtlWatermark: vi.fn(),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }),
    };
    const controller = new ActorAnalyticsController(repo as never, routing as never);

    await expect(
      controller.crossDao('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });
});
