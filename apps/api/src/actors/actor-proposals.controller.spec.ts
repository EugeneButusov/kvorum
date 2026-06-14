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

  it('passes cursor through assertCursorMatchesQuery in actor-proposals list', async () => {
    const qb = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };
    const proposalRepo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'actor-1' } }),
    };
    const controller = new ActorProposalsController(proposalRepo as never, routing as never);

    const { canonicalQuery, encodeCursor } = await import('../pagination/cursor');
    const { parseQuery } = await import('../query/query-parser');
    const { ACTOR_PROPOSAL_QUERY } = await import('./actor-proposal.query');

    const canonical = canonicalQuery(parseQuery({}, ACTOR_PROPOSAL_QUERY));
    const cursorStr = encodeCursor({
      type: 'time',
      value: '2026-01-01T00:00:00.000Z',
      tiebreak: 'p0',
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

  it('paginates with created_at sort (covers FALSE branch of voting_starts_at check in callback)', async () => {
    const baseRow = {
      id: 'proposal-row-1',
      dao_slug: 'compound',
      source_type: 'comp',
      source_id: '42',
      title: 'T',
      description: 'desc',
      description_hash: 'a'.repeat(64),
      state: 'active',
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '1',
      voting_ends_block: '2',
      state_updated_at: new Date('2026-01-01'),
      created_at: new Date('2026-01-02'),
      proposer_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      proposer_display_name: null,
    };
    const qb = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi
        .fn()
        .mockResolvedValue([
          baseRow,
          { ...baseRow, id: 'proposal-row-2', created_at: new Date('2026-01-01') },
        ]),
    };
    const proposalRepo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'actor-1' } }),
    };
    const controller = new ActorProposalsController(proposalRepo as never, routing as never);

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { limit: '1', sort: '-created_at' } as never,
      mockResponse(),
    );
    expect(out?.pagination.next_cursor).not.toBeNull();
  });

  it('uses voting_starts_at cursor value (null → infinity sentinel for asc)', async () => {
    const qb = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([
        {
          id: 'proposal-row-1',
          dao_slug: 'compound',
          source_type: 'compound_governor_bravo',
          source_id: '42',
          title: null,
          description: 'desc',
          description_hash: 'a'.repeat(64),
          state: 'active',
          binding: true,
          voting_starts_at: null,
          voting_ends_at: new Date('2026-02-01'),
          voting_starts_block: '1',
          voting_ends_block: '2',
          state_updated_at: new Date('2026-01-01'),
          created_at: new Date('2025-12-31'),
          proposer_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          proposer_display_name: null,
        },
        {
          id: 'proposal-row-2',
          dao_slug: 'compound',
          source_type: 'compound_governor_bravo',
          source_id: '43',
          title: 'T',
          description: 'desc',
          description_hash: 'b'.repeat(64),
          state: 'active',
          binding: true,
          voting_starts_at: null,
          voting_ends_at: null,
          voting_starts_block: '1',
          voting_ends_block: '2',
          state_updated_at: new Date('2026-01-01'),
          created_at: new Date('2025-12-30'),
          proposer_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          proposer_display_name: null,
        },
      ]),
    };

    const proposalRepo = { listBaseQuery: vi.fn().mockReturnValue(qb) };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'actor-1' } }),
    };
    const controller = new ActorProposalsController(proposalRepo as never, routing as never);

    const out = await controller.list(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { limit: '1', sort: 'voting_starts_at' } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
    expect(out?.pagination.next_cursor).not.toBeNull();
  });
});
