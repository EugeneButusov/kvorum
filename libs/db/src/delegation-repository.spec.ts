import { describe, expect, it, vi } from 'vitest';
import { DelegationRepository } from './delegation-repository';

describe('DelegationRepository', () => {
  it('inserts delegation row', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ execute });
    const insertInto = vi.fn().mockReturnValue({ values });
    const repo = new DelegationRepository({ insertInto } as never);

    const row = {
      dao_id: 'dao-1',
      delegator_actor_id: 'actor-1',
      delegate_actor_id: 'actor-2',
      voting_power: '100',
      block_number: '123',
      tx_hash: '0xtx',
      event_type: 'delegate_changed' as const,
    };

    await repo.insert(row);

    expect(insertInto).toHaveBeenCalledWith('delegation');
    expect(values).toHaveBeenCalledWith(row);
  });

  it('lists snapshot delegation events ordered up to max block', async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        event_type: 'votes_changed',
        delegator_actor_id: 'actor-1',
        delegate_actor_id: 'actor-2',
        voting_power: '123',
      },
    ]);
    const orderByLog = vi.fn().mockReturnValue({ execute });
    const orderByTx = vi.fn().mockReturnValue({ orderBy: orderByLog });
    const orderByBlock = vi.fn().mockReturnValue({ orderBy: orderByTx });
    const whereBlock = vi.fn().mockReturnValue({ orderBy: orderByBlock });
    const whereDao = vi.fn().mockReturnValue({ where: whereBlock });
    const select = vi.fn().mockReturnValue({ where: whereDao });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new DelegationRepository({ selectFrom } as never);

    const rows = await repo.listForSnapshot('dao-1', '100');

    expect(rows).toEqual([
      {
        event_type: 'votes_changed',
        delegator_actor_id: 'actor-1',
        delegate_actor_id: 'actor-2',
        voting_power: '123',
      },
    ]);
    expect(selectFrom).toHaveBeenCalledWith('delegation');
    expect(select).toHaveBeenCalledWith([
      'event_type',
      'delegator_actor_id',
      'delegate_actor_id',
      'voting_power',
    ]);
    expect(whereDao).toHaveBeenCalledWith('dao_id', '=', 'dao-1');
    expect(whereBlock).toHaveBeenCalledWith('block_number', '<=', '100');
    expect(orderByBlock).toHaveBeenCalledWith('block_number', 'asc');
    expect(orderByTx).toHaveBeenCalledWith('tx_index', 'asc');
    expect(orderByLog).toHaveBeenCalledWith('log_index', 'asc');
  });
});
