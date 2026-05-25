import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ActorProposalsController } from './actor-proposals.controller';
import { ProblemException } from '../http/problem-exception';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

describe('ActorProposalsController', () => {
  it('returns actor proposal list for a resolved actor', async () => {
    const qb = {
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      execute: vi.fn(),
    };
    qb.where.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.limit.mockReturnValue(qb);
    qb.execute.mockResolvedValue([
      {
        id: 'proposal-row-1',
        dao_slug: 'compound',
        source_type: 'compound_governor_bravo',
        source_id: '42',
        title: 'Test Proposal',
        description: 'desc',
        description_hash: 'a'.repeat(64),
        state: 'active',
        binding: true,
        voting_starts_at: new Date('2026-01-01T00:00:00Z'),
        voting_ends_at: null,
        voting_starts_block: '1',
        voting_ends_block: '2',
        voting_power_block: '1',
        state_updated_at: new Date('2026-01-01T01:00:00Z'),
        created_at: new Date('2025-12-31T00:00:00Z'),
        proposer_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        proposer_display_name: null,
      },
    ]);

    const proposalRepo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'ok',
        actor: { id: 'actor-1' },
      }),
    };
    const controller = new ActorProposalsController(proposalRepo as never, routing as never);

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { limit: 1 } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
    expect(out?.data[0]?.proposal_id).toBe('42');
  });

  it('redirects merged/non-primary actor address', async () => {
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'redirect',
        survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    };
    const controller = new ActorProposalsController(
      { listBaseQuery: vi.fn() } as never,
      routing as never,
    );
    const res = mockResponse();

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      {} as never,
      res,
    );

    expect(out).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(301);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Location',
      '/v1/actors/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/proposals',
    );
  });

  it('throws actor-not-found for unknown actor', async () => {
    const routing = { resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }) };
    const controller = new ActorProposalsController(
      { listBaseQuery: vi.fn() } as never,
      routing as never,
    );

    await expect(
      controller.list('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {} as never, mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });
});
