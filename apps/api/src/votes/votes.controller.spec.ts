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

  it('throws not-found when proposal is missing in list', async () => {
    const notFoundProposalRepo = { findOneWithDao: vi.fn().mockResolvedValue(undefined) };
    const controller = new VotesController(
      { listForProposal: vi.fn() } as never,
      notFoundProposalRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    await expect(
      controller.list('compound', 'comp', '1', {} as never, mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });

  it('redirects voter query param to canonical address', async () => {
    const voteRepo = { listForProposal: vi.fn() };
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

    const out = await controller.list(
      'compound',
      'comp',
      '1',
      { voter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } as never,
      res,
    );

    expect(out).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(301);
  });

  it('returns empty list when voter address is not found', async () => {
    const voteRepo = { listForProposal: vi.fn() };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
    );

    const out = await controller.list(
      'compound',
      'comp',
      '1',
      { voter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(0);
  });

  it('returns paginated list sorted by voting_power_reported', async () => {
    const voteRepo = {
      listForProposal: vi.fn().mockResolvedValue([
        {
          id: 'v1',
          voting_power_reported: '200',
          voting_power_verified: true,
          primary_choice: 1,
          cast_at: new Date('2026-01-01'),
          reason: null,
          proposal_id: 'p1',
          voter_actor_id: 'a1',
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
          id: 'v2',
          voting_power_reported: '100',
          voting_power_verified: false,
          primary_choice: 0,
          cast_at: new Date('2026-01-02'),
          reason: null,
          proposal_id: 'p1',
          voter_actor_id: 'a2',
          voter_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
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
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    const out = await controller.list(
      'compound',
      'comp',
      '1',
      { limit: '1', sort: '-voting_power_reported' } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
    expect(out?.pagination.next_cursor).not.toBeNull();
  });

  it('returns vote detail for known voter', async () => {
    const vote = {
      id: 'v1',
      voting_power_reported: '100',
      voting_power_verified: true,
      primary_choice: 1,
      cast_at: new Date('2026-01-01'),
      reason: 'good',
      proposal_id: 'p1',
      voter_actor_id: 'a1',
      voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      voter_display_name: 'Alice',
      proposal_source_type: 'comp',
      proposal_source_id: '1',
      proposal_title: 'T',
      proposal_state: 'active',
      proposal_created_at: new Date('2025-12-31'),
      proposal_voting_ends_at: null,
      dao_slug: 'compound',
    };
    const voteRepo = {
      findOneByVoter: vi.fn().mockResolvedValue(vote),
      findChoicesForVote: vi.fn().mockResolvedValue([{ choice_index: 0, weight: '1' }]),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'a1' } }),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
    );

    const out = await controller.detail(
      'compound',
      'comp',
      '1',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mockResponse(),
    );

    expect(out?.data.vote_id).toBe('v1');
    expect(out?.data.choices).toHaveLength(1);
  });

  it('returns votes when voter resolves to ok (covers voterActorId assignment)', async () => {
    const voteRow = {
      id: 'v1',
      voting_power_reported: '100',
      voting_power_verified: true,
      primary_choice: 1,
      cast_at: new Date('2026-01-01'),
      reason: null,
      proposal_id: 'p1',
      voter_actor_id: 'a1',
      voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      voter_display_name: null,
      proposal_source_type: 'comp',
      proposal_source_id: '1',
      proposal_title: 'T',
      proposal_state: 'active',
      proposal_created_at: new Date('2025-12-31'),
      proposal_voting_ends_at: null,
      dao_slug: 'compound',
    };
    const voteRepo = { listForProposal: vi.fn().mockResolvedValue([voteRow]) };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'a1' } }),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
    );

    const out = await controller.list(
      'compound',
      'comp',
      '1',
      { voter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
  });

  it('throws not-found when vote is missing in detail', async () => {
    const voteRepo = {
      findOneByVoter: vi.fn().mockResolvedValue(undefined),
      findChoicesForVote: vi.fn(),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'a1' } }),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
    );

    await expect(
      controller.detail('compound', 'comp', '1', '0xaaaa', mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });

  it('paginates with cast_at sort (covers time branch in buildPagination callback)', async () => {
    const voteRow = {
      id: 'v1',
      voting_power_reported: '100',
      voting_power_verified: true,
      primary_choice: 1,
      cast_at: new Date('2026-01-02'),
      reason: null,
      proposal_id: 'p1',
      voter_actor_id: 'a1',
      voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      voter_display_name: null,
      proposal_source_type: 'comp',
      proposal_source_id: '1',
      proposal_title: 'T',
      proposal_state: 'active',
      proposal_created_at: new Date('2025-12-31'),
      proposal_voting_ends_at: null,
      dao_slug: 'compound',
    };
    const voteRepo = {
      listForProposal: vi
        .fn()
        .mockResolvedValue([voteRow, { ...voteRow, id: 'v2', cast_at: new Date('2026-01-01') }]),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    const out = await controller.list(
      'compound',
      'comp',
      '1',
      { limit: '1', sort: '-cast_at' } as never,
      mockResponse(),
    );
    expect(out?.pagination.next_cursor).not.toBeNull();
  });

  it('filters list by primary_choice (covers primaryChoices non-null branch)', async () => {
    const voteRepo = { listForProposal: vi.fn().mockResolvedValue([]) };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    const out = await controller.list(
      'compound',
      'comp',
      '1',
      { primary_choice: '1' } as never,
      mockResponse(),
    );
    expect(out?.data).toHaveLength(0);
    const call = voteRepo.listForProposal.mock.calls[0]?.[0] as { primaryChoices?: unknown };
    expect(call.primaryChoices).toBeDefined();
  });

  it('passes cursor through assertCursorMatchesQuery in votes list', async () => {
    const voteRepo = { listForProposal: vi.fn().mockResolvedValue([]) };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    const { canonicalQuery, encodeCursor } = await import('../pagination/cursor');
    const { parseQuery } = await import('../query/query-parser');
    const { VOTE_QUERY } = await import('./vote.query');

    const canonical = canonicalQuery(parseQuery({}, VOTE_QUERY));
    const cursorStr = encodeCursor({
      type: 'time',
      value: '2026-01-01T00:00:00.000Z',
      tiebreak: 'v0',
      dir: 'desc',
      q: canonical,
    });

    const out = await controller.list(
      'compound',
      'comp',
      '1',
      { cursor: cursorStr } as never,
      mockResponse(),
    );
    expect(out?.data).toHaveLength(0);
  });

  it('throws not-found when proposal is missing in detail', async () => {
    const notFoundProposalRepo = { findOneWithDao: vi.fn().mockResolvedValue(undefined) };
    const routing = { resolveAddress: vi.fn() };
    const controller = new VotesController(
      { findOneByVoter: vi.fn() } as never,
      notFoundProposalRepo as never,
      routing as never,
    );

    await expect(
      controller.detail('compound', 'comp', '1', '0xaaaa', mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });
});
