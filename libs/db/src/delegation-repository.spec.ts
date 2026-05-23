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
});
