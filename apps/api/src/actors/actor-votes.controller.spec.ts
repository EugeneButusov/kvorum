import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ActorVotesController } from './actor-votes.controller';
import { ProblemException } from '../http/problem-exception';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

describe('ActorVotesController', () => {
  it('returns actor vote list for a resolved actor', async () => {
    const voteRepo = {
      listForActor: vi.fn().mockResolvedValue([
        {
          id: 'vote-1',
          voting_power_reported: '123.45',
          voting_power_verified: false,
          primary_choice: 1,
          cast_at: new Date('2026-01-01T00:00:00Z'),
          reason: null,
          proposal_id: 'proposal-row-1',
          voter_actor_id: 'actor-1',
          voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          voter_display_name: null,
          proposal_source_type: 'compound_governor_bravo',
          proposal_source_id: '42',
          proposal_title: 'Test Proposal',
          proposal_state: 'active',
          proposal_created_at: new Date('2025-12-31T00:00:00Z'),
          proposal_voting_ends_at: null,
          dao_slug: 'compound',
        },
      ]),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'ok',
        actor: { id: 'actor-1' },
      }),
    };
    const controller = new ActorVotesController(voteRepo as never, routing as never);

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { limit: 1 } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
    expect(out?.data[0]?.vote_id).toBe('vote-1');
    expect(out?.data[0]?.proposal.proposal_id).toBe('42');
  });

  it('redirects merged/non-primary actor address', async () => {
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'redirect',
        survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    };
    const controller = new ActorVotesController(
      { listForActor: vi.fn() } as never,
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
      '/v1/actors/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/votes',
    );
  });

  it('throws actor-not-found for unknown actor', async () => {
    const routing = { resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }) };
    const controller = new ActorVotesController(
      { listForActor: vi.fn() } as never,
      routing as never,
    );

    await expect(
      controller.list('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {} as never, mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });

  it('paginates with cast_at sort (covers time branch in buildPagination callback)', async () => {
    const voteRepo = {
      listForActor: vi.fn().mockResolvedValue([
        {
          id: 'vote-1',
          voting_power_reported: '100',
          voting_power_verified: true,
          primary_choice: 1,
          cast_at: new Date('2026-01-02'),
          reason: null,
          proposal_id: 'p1',
          voter_actor_id: 'actor-1',
          voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          voter_display_name: null,
          proposal_source_type: 'comp',
          proposal_source_id: '1',
          proposal_title: 'T',
          proposal_state: 'active',
          proposal_created_at: new Date('2025-12-31'),
          proposal_voting_ends_at: new Date('2026-03-01'),
          dao_slug: 'compound',
        },
        {
          id: 'vote-2',
          voting_power_reported: '50',
          voting_power_verified: false,
          primary_choice: 0,
          cast_at: new Date('2026-01-01'),
          reason: null,
          proposal_id: 'p1',
          voter_actor_id: 'actor-1',
          voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          voter_display_name: null,
          proposal_source_type: 'comp',
          proposal_source_id: '1',
          proposal_title: 'T',
          proposal_state: 'active',
          proposal_created_at: new Date('2025-12-31'),
          proposal_voting_ends_at: null,
          dao_slug: 'compound',
        },
      ]),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'actor-1' } }),
    };
    const controller = new ActorVotesController(voteRepo as never, routing as never);

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { limit: '1', sort: '-cast_at' } as never,
      mockResponse(),
    );
    expect(out?.pagination.next_cursor).not.toBeNull();
  });

  it('uses cursor (covers assertCursorMatchesQuery in actor-votes list)', async () => {
    const voteRepo = {
      listForActor: vi.fn().mockResolvedValue([]),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'actor-1' } }),
    };
    const controller = new ActorVotesController(voteRepo as never, routing as never);

    const { canonicalQuery, encodeCursor } = await import('../pagination/cursor');
    const { parseQuery } = await import('../query/query-parser');
    const { ACTOR_VOTE_QUERY } = await import('./actor-vote.query');

    const canonical = canonicalQuery(parseQuery({}, ACTOR_VOTE_QUERY));
    const cursorStr = encodeCursor({
      type: 'time',
      value: '2026-01-01T00:00:00.000Z',
      tiebreak: 'v0',
      dir: 'desc',
      q: canonical,
    });

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { cursor: cursorStr } as never,
      mockResponse(),
    );
    expect(out?.data).toHaveLength(0);
  });

  it('paginates with voting_power_reported sort (hasMore=true covers cursor callback)', async () => {
    const voteRepo = {
      listForActor: vi.fn().mockResolvedValue([
        {
          id: 'vote-1',
          voting_power_reported: '200',
          voting_power_verified: true,
          primary_choice: 1,
          cast_at: new Date('2026-01-02'),
          reason: null,
          proposal_id: 'p1',
          voter_actor_id: 'actor-1',
          voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          voter_display_name: null,
          proposal_source_type: 'comp',
          proposal_source_id: '1',
          proposal_title: 'T',
          proposal_state: 'active',
          proposal_created_at: new Date('2025-12-31'),
          proposal_voting_ends_at: null,
          dao_slug: 'compound',
        },
        {
          id: 'vote-2',
          voting_power_reported: '100',
          voting_power_verified: false,
          primary_choice: 0,
          cast_at: new Date('2026-01-01'),
          reason: null,
          proposal_id: 'p1',
          voter_actor_id: 'actor-1',
          voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          voter_display_name: null,
          proposal_source_type: 'comp',
          proposal_source_id: '1',
          proposal_title: 'T',
          proposal_state: 'active',
          proposal_created_at: new Date('2025-12-31'),
          proposal_voting_ends_at: new Date('2026-03-01'),
          dao_slug: 'compound',
        },
      ]),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'actor-1' } }),
    };
    const controller = new ActorVotesController(voteRepo as never, routing as never);

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { limit: '1', sort: '-voting_power_reported' } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
    expect(out?.pagination.next_cursor).not.toBeNull();
  });
});
