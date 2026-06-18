import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { VotesController } from './votes.controller';
import { ProblemException } from '../http/problem-exception';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

// Compound choice bounds (0..2) so primary_choice input validation passes for 1.
const contributions = [
  {
    sourceTypes: ['compound_governor_bravo'],
    choiceBounds: () => ({ min: 0, max: 2 }),
    delegationModel: () => 'power-bearing' as const,
    getProposalExtension: () => Promise.resolve(null),
  },
];

function makeVoteRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v1',
    voting_chain_id: '0x1',
    voting_power_reported: '100',
    voting_power_verified: true,
    primary_choice: 1,
    cast_at: new Date('2026-01-01T00:00:00Z'),
    reason: null,
    proposal_id: 'p1',
    voter_actor_id: 'a1',
    voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    voter_display_name: null,
    proposal_source_type: 'compound_governor_bravo',
    proposal_source_id: '1',
    proposal_title: 'T',
    proposal_state: 'active',
    proposal_created_at: new Date('2025-12-31T00:00:00Z'),
    proposal_voting_ends_at: null,
    dao_slug: 'compound',
    ...overrides,
  };
}

describe('VotesController', () => {
  const proposalRepo = {
    findOneWithDao: vi.fn().mockResolvedValue({ proposal: { id: 'p1' } }),
  };

  it('returns paginated vote list', async () => {
    const voteRepo = {
      listForProposal: vi.fn().mockResolvedValue([makeVoteRow({ voter_display_name: 'Alice' })]),
    };
    const routing = { resolveAddress: vi.fn() };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
      contributions as never,
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
    expect(out?.data[0]?.voting_chain_id).toBe('0x1');
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
      contributions as never,
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
      contributions as never,
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
      contributions as never,
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
      contributions as never,
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
      contributions as never,
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
        makeVoteRow({
          id: 'v1',
          voting_power_reported: '200',
          voter_actor_id: 'a1',
          voter_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
        makeVoteRow({
          id: 'v2',
          voting_power_reported: '100',
          primary_choice: 0,
          cast_at: new Date('2026-01-02'),
          voter_actor_id: 'a2',
          voter_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        }),
      ]),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
      contributions as never,
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
    const vote = makeVoteRow({
      reason: 'good',
      voter_display_name: 'Alice',
      proposal_source_type: 'comp',
    });
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
      contributions as never,
    );

    const out = await controller.detail(
      'compound',
      'comp',
      '1',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mockResponse(),
    );

    expect(out?.data.vote_id).toBe('v1');
    expect(out?.data.voting_chain_id).toBe('0x1');
    expect(out?.data.choices).toHaveLength(1);
  });

  it('returns votes when voter resolves to ok (covers voterActorId assignment)', async () => {
    const voteRepo = { listForProposal: vi.fn().mockResolvedValue([makeVoteRow()]) };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'a1' } }),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      routing as never,
      contributions as never,
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
      contributions as never,
    );

    await expect(
      controller.detail('compound', 'comp', '1', '0xaaaa', mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });

  it('paginates with cast_at sort (covers time branch in buildPagination callback)', async () => {
    const voteRepo = {
      listForProposal: vi
        .fn()
        .mockResolvedValue([
          makeVoteRow({ id: 'v1', cast_at: new Date('2026-01-02') }),
          makeVoteRow({ id: 'v2', cast_at: new Date('2026-01-01') }),
        ]),
    };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
      contributions as never,
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
      contributions as never,
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

  it('rejects primary_choice input outside the source choice bounds (400)', async () => {
    const voteRepo = { listForProposal: vi.fn() };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
      contributions as never,
    );

    // compound_governor_bravo bounds are 0..2; choice 5 is out of range → 400.
    await expect(
      controller.list(
        'compound',
        'compound_governor_bravo',
        '1',
        { primary_choice: '5' } as never,
        mockResponse(),
      ),
    ).rejects.toBeInstanceOf(ProblemException);
    expect(voteRepo.listForProposal).not.toHaveBeenCalled();
  });

  it('passes cursor through assertCursorMatchesQuery in votes list', async () => {
    const voteRepo = { listForProposal: vi.fn().mockResolvedValue([]) };
    const controller = new VotesController(
      voteRepo as never,
      proposalRepo as never,
      { resolveAddress: vi.fn() } as never,
      contributions as never,
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
      contributions as never,
    );

    await expect(
      controller.detail('compound', 'comp', '1', '0xaaaa', mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });
});
