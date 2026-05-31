import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { DELEGATION_QUERY } from './delegation.query';
import { DelegationsController } from './delegations.controller';
import { ProblemException } from '../http/problem-exception';
import { canonicalQuery, encodeCursor } from '../pagination/cursor';
import { parseQuery } from '../query/query-parser';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

describe('DelegationsController', () => {
  const daoRepo = {
    findDaoBySlug: vi.fn().mockResolvedValue({ id: 'dao-1', slug: 'compound' }),
  };

  it('returns delegation list', async () => {
    const delegationRepo = {
      listForDao: vi.fn().mockResolvedValue([
        {
          id: 'd1',
          dao_id: 'dao-1',
          voting_power: '100',
          block_number: '123',
          tx_hash: '0xhash',
          event_type: 'delegate_changed',
          created_at: new Date('2026-01-01T00:00:00Z'),
          dao_slug: 'compound',
          delegator_actor_id: 'a1',
          delegator_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          delegator_display_name: 'Alice',
          delegate_actor_id: null,
          delegate_address: null,
          delegate_display_name: null,
        },
      ]),
    };
    const routing = { resolveAddress: vi.fn() };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      routing as never,
    );

    const out = await controller.list('compound', { limit: 1 } as never);
    expect(out.data).toHaveLength(1);
    expect(out.data[0]?.delegation_id).toBe('d1');
  });

  it('redirects current delegators route for merged delegate', async () => {
    const delegationRepo = { currentConfirmedHead: vi.fn(), currentDelegators: vi.fn() };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'redirect',
        survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      routing as never,
    );
    const res = mockResponse();

    const out = await controller.current(
      'compound',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      {} as never,
      res,
    );

    expect(out).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(301);
  });

  it('returns null actor delegation when none exists', async () => {
    const delegationRepo = {
      findCurrentDelegationForActor: vi.fn().mockResolvedValue(undefined),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'ok',
        actor: { id: 'a1' },
      }),
    };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      routing as never,
    );

    const out = await controller.actorDelegation(
      'compound',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mockResponse(),
    );

    expect(out).toEqual({ data: null });
  });

  it('throws actor-not-found for unknown actor in delegation route', async () => {
    const delegationRepo = {
      findCurrentDelegationForActor: vi.fn(),
    };
    const routing = { resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }) };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      routing as never,
    );

    await expect(
      controller.actorDelegation(
        'compound',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        mockResponse(),
      ),
    ).rejects.toBeInstanceOf(ProblemException);
  });

  it('throws not-found when dao is missing in list', async () => {
    const notFoundDaoRepo = { findDaoBySlug: vi.fn().mockResolvedValue(undefined) };
    const controller = new DelegationsController(
      { listForDao: vi.fn() } as never,
      notFoundDaoRepo as never,
      { resolveAddress: vi.fn() } as never,
    );
    await expect(controller.list('unknown', {} as never)).rejects.toBeInstanceOf(ProblemException);
  });

  it('sorts and paginates list with block_number sort and hasMore=true', async () => {
    const row1 = {
      id: 'd1',
      dao_id: 'dao-1',
      voting_power: '200',
      block_number: '200',
      tx_hash: '0xhash',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-02'),
      dao_slug: 'compound',
      delegator_actor_id: 'a1',
      delegator_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      delegator_display_name: null,
      delegate_actor_id: null,
      delegate_address: null,
      delegate_display_name: null,
    };
    const row2 = {
      id: 'd2',
      dao_id: 'dao-1',
      voting_power: '100',
      block_number: '100',
      tx_hash: '0xhash2',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-01'),
      dao_slug: 'compound',
      delegator_actor_id: 'a2',
      delegator_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      delegator_display_name: null,
      delegate_actor_id: null,
      delegate_address: null,
      delegate_display_name: null,
    };
    const delegationRepo = { listForDao: vi.fn().mockResolvedValue([row1, row2]) };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    const out = await controller.list('compound', { limit: '1', sort: 'block_number' } as never);
    expect(out.data).toHaveLength(1);
    expect(out.pagination.next_cursor).not.toBeNull();
  });

  it('filters list by delegator address (string filter branch)', async () => {
    const delegationRepo = { listForDao: vi.fn().mockResolvedValue([]) };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    const out = await controller.list('compound', {
      delegator: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      delegate: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      from_block_min: '100',
      from_block_max: '200',
    } as never);
    expect(out.data).toHaveLength(0);
    const call = delegationRepo.listForDao.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['delegatorAddress']).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(call['fromBlockMin']).toBe('100');
  });

  it('passes cursor through assertCursorMatchesQuery and filters rows via isAfterCursor', async () => {
    const row1 = {
      id: 'd1',
      dao_id: 'dao-1',
      voting_power: '200',
      block_number: '200',
      tx_hash: '0xhash',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-02'),
      dao_slug: 'compound',
      delegator_actor_id: 'a1',
      delegator_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      delegator_display_name: null,
      delegate_actor_id: null,
      delegate_address: null,
      delegate_display_name: null,
    };
    const row2 = {
      id: 'd2',
      dao_id: 'dao-1',
      voting_power: '100',
      block_number: '100',
      tx_hash: '0xhash2',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-01'),
      dao_slug: 'compound',
      delegator_actor_id: 'a2',
      delegator_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      delegator_display_name: null,
      delegate_actor_id: null,
      delegate_address: null,
      delegate_display_name: null,
    };
    const delegationRepo = { listForDao: vi.fn().mockResolvedValue([row1, row2]) };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    const canonical = canonicalQuery(parseQuery({}, DELEGATION_QUERY));
    const cursorStr = encodeCursor({
      type: 'bigint',
      value: '150',
      tiebreak: 'd0',
      dir: 'desc',
      q: canonical,
    });

    const out = await controller.list('compound', { cursor: cursorStr } as never);
    // Only row1 (block_number=200) should survive the cursor filter (>150 desc)
    expect(out.data).toHaveLength(1);
  });

  it('covers isAfterCursor time path with created_at sort (row after cursor survives)', async () => {
    const row1 = {
      id: 'd1',
      dao_id: 'dao-1',
      voting_power: '100',
      block_number: '100',
      tx_hash: '0xhash',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-03'),
      dao_slug: 'compound',
      delegator_actor_id: 'a1',
      delegator_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      delegator_display_name: null,
      delegate_actor_id: null,
      delegate_address: null,
      delegate_display_name: null,
    };
    const row2 = {
      ...row1,
      id: 'd2',
      created_at: new Date('2026-01-02'),
      delegator_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };
    const row3 = {
      ...row1,
      id: 'd3',
      created_at: new Date('2026-01-01'),
      delegator_address: '0xcccccccccccccccccccccccccccccccccccccccc',
    };
    const delegationRepo = { listForDao: vi.fn().mockResolvedValue([row1, row2, row3]) };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      { resolveAddress: vi.fn() } as never,
    );

    // cursor at row2 (2026-01-02, dir=desc) → only row3 (earlier time) passes isAfterCursor
    const canonical = canonicalQuery(parseQuery({ sort: '-created_at' }, DELEGATION_QUERY));
    const cursorStr = encodeCursor({
      type: 'time',
      value: row2.created_at.toISOString(),
      tiebreak: 'd2',
      dir: 'desc',
      q: canonical,
    });

    const out = await controller.list('compound', {
      sort: '-created_at',
      cursor: cursorStr,
    } as never);
    expect(out.data).toHaveLength(1);
    expect(out.data[0]?.delegation_id).toBe('d3');
  });

  it('returns current delegators for resolved delegate with explicit as_of_block_number (hasMore=true, cursor tiebreak set)', async () => {
    const baseRow = {
      id: 'd1',
      dao_id: 'dao-1',
      voting_power: '100',
      block_number: '999',
      tx_hash: '0xhash',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-01'),
      dao_slug: 'compound',
      delegator_actor_id: 'a1',
      delegator_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      delegator_display_name: null,
      delegate_actor_id: null,
      delegate_address: null,
      delegate_display_name: null,
    };
    const delegationRepo = {
      currentConfirmedHead: vi.fn(),
      currentDelegators: vi.fn().mockResolvedValue([baseRow, { ...baseRow, id: 'd2' }]),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'a1' } }),
    };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      routing as never,
    );

    // Pass a valid cursor (covers cursor tiebreak != null branch)
    const cursorStr = encodeCursor({
      type: 'bigint',
      value: '0',
      tiebreak: '0xstart',
      dir: 'asc',
      q: 'current_delegators_v1',
    });

    const out = await controller.current(
      'compound',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { as_of_block_number: '999', limit: '1', cursor: cursorStr } as never,
      mockResponse(),
    );

    expect(out?.data).toHaveLength(1);
    expect(out?._meta.as_of_block_number).toBe('999');
    expect(out?.pagination.next_cursor).not.toBeNull();
  });

  it('fetches currentConfirmedHead when as_of_block_number is absent', async () => {
    const delegationRepo = {
      currentConfirmedHead: vi.fn().mockResolvedValue('500'),
      currentDelegators: vi.fn().mockResolvedValue([]),
    };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'a1' } }),
    };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      routing as never,
    );

    const out = await controller.current(
      'compound',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      {} as never,
      mockResponse(),
    );

    expect(out?._meta.as_of_block_number).toBe('500');
    expect(delegationRepo.currentConfirmedHead).toHaveBeenCalledWith('dao-1');
  });

  it('returns 301 redirect for merged actor in actorDelegation', async () => {
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'redirect',
        survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    };
    const controller = new DelegationsController(
      { findCurrentDelegationForActor: vi.fn() } as never,
      daoRepo as never,
      routing as never,
    );
    const res = mockResponse();

    const out = await controller.actorDelegation(
      'compound',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      res,
    );
    expect(out).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(301);
  });

  it('returns non-null actor delegation when row exists (with non-null delegate_address)', async () => {
    const row = {
      id: 'd1',
      dao_id: 'dao-1',
      voting_power: '100',
      block_number: '99',
      tx_hash: '0xhash',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-01'),
      dao_slug: 'compound',
      delegator_actor_id: 'a1',
      delegator_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      delegator_display_name: null,
      delegate_actor_id: 'a2',
      delegate_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      delegate_display_name: 'Bob',
    };
    const delegationRepo = { findCurrentDelegationForActor: vi.fn().mockResolvedValue(row) };
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'ok', actor: { id: 'a1' } }),
    };
    const controller = new DelegationsController(
      delegationRepo as never,
      daoRepo as never,
      routing as never,
    );

    const out = await controller.actorDelegation(
      'compound',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mockResponse(),
    );
    expect(out?.data).not.toBeNull();
    expect((out?.data as { delegation_id: string } | null)?.delegation_id).toBe('d1');
  });
});
