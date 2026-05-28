import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { VotesController } from './votes.controller';
import { ProblemException } from '../http/problem-exception';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

describe('VotesController', () => {
  const proposalRepo = {
    findOneWithDao: vi.fn().mockResolvedValue({ proposal: { id: 'p1' } }),
  };

  it('returns paginated vote list', async () => {
    const voteRepo = {
      listForProposal: vi.fn().mockResolvedValue([
        {
          id: 'v1',
          voting_power_reported: '100',
          voting_power_verified: true,
          primary_choice: 1,
          cast_at: new Date('2026-01-01T00:00:00Z'),
          reason: null,
          proposal_id: 'p1',
          voter_actor_id: 'a1',
          voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          voter_display_name: 'Alice',
          proposal_source_type: 'compound_governor_bravo',
          proposal_source_id: '1',
          proposal_title: 'Title',
          proposal_state: 'active',
          proposal_created_at: new Date('2025-12-31T00:00:00Z'),
          proposal_voting_ends_at: null,
          dao_slug: 'compound',
        },
      ]),
    };
    const routing = { resolveAddress: vi.fn() };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
    );

    const out = await controller.list(
      'compound',
      'compound_governor_bravo',
      '1',
      { limit: 1 } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
    expect(out?.data[0]?.vote_id).toBe('v1');
  });

  it('returns 301 on merged voter path', async () => {
    const voteRepo = { findOneByVoter: vi.fn(), findChoicesForVote: vi.fn() };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'redirect',
        survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
    );
    const res = mockResponse();

    const out = await controller.detail(
      'compound',
      'compound_governor_bravo',
      '1',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      res,
    );

    expect(out).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(301);
  });

  it('throws actor-not-found for unknown voter path', async () => {
    const voteRepo = { findOneByVoter: vi.fn(), findChoicesForVote: vi.fn() };
    const routing = { resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }) };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
    );

    await expect(
      controller.detail(
        'compound',
        'compound_governor_bravo',
        '1',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        mockResponse(),
      ),
    ).rejects.toBeInstanceOf(ProblemException);
  });
});
