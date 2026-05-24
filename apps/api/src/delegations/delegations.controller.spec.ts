import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { DelegationsController } from './delegations.controller';
import { ProblemException } from '../http/problem-exception';

function mockResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

describe('DelegationsController', () => {
  const daoRepo = {
    findDaoBySlug: vi.fn().mockResolvedValue({ id: 'dao-1', slug: 'compound' }),
  };

  it('returns delegation list', async () => {
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
    ]);

    const delegationRepo = {
      listBaseQuery: vi.fn().mockReturnValue(qb),
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
});
