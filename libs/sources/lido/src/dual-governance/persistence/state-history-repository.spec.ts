import { describe, expect, it, vi } from 'vitest';
import { DualGovernanceStateHistoryRepository } from './state-history-repository';
import type { NewDualGovernanceStateHistory } from '../../persistence/schema';

const ROW: NewDualGovernanceStateHistory = {
  dao_id: 'dao-1',
  state: 'normal',
  transition_at: new Date('2025-08-08T10:21:47Z'),
  block_number: '23095715',
  tx_hash: '0x' + 'cd'.repeat(32),
  log_index: 0,
  rage_quit_eth_amount: null,
  veto_signaling_started_at: null,
  veto_signaling_deactivated_at: null,
  payload: { from: 'NotInitialized', to: 'Normal' },
};

describe('DualGovernanceStateHistoryRepository', () => {
  it('insert returns inserted=true when a row is written', async () => {
    const onConflictBuilder = {
      columns: vi.fn().mockReturnThis(),
      doNothing: vi.fn().mockReturnThis(),
    };
    const execute = vi.fn().mockResolvedValue({ id: 'uuid-1' });
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockImplementation((cb: (b: typeof onConflictBuilder) => unknown) => {
        cb(onConflictBuilder);
        return chain;
      }),
      returning: vi.fn().mockReturnThis(),
      executeTakeFirst: execute,
    };
    const db = { insertInto: vi.fn().mockReturnValue(chain) } as never;
    const repo = new DualGovernanceStateHistoryRepository(db);

    await expect(repo.insert(ROW)).resolves.toEqual({ inserted: true });
    expect(onConflictBuilder.columns).toHaveBeenCalledWith([
      'dao_id',
      'block_number',
      'tx_hash',
      'log_index',
    ]);
  });

  it('insert returns inserted=false when the row already existed (ON CONFLICT)', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined),
    };
    const db = { insertInto: vi.fn().mockReturnValue(chain) } as never;
    await expect(new DualGovernanceStateHistoryRepository(db).insert(ROW)).resolves.toEqual({
      inserted: false,
    });
  });

  it('currentState reads the latest transition for a dao', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ state: 'veto_signaling' }),
    };
    const db = { selectFrom: vi.fn().mockReturnValue(chain) } as never;
    await expect(new DualGovernanceStateHistoryRepository(db).currentState('dao-1')).resolves.toBe(
      'veto_signaling',
    );
    expect(chain.orderBy).toHaveBeenCalledWith('transition_at', 'desc');
  });

  it('stateAt bounds the lookup by transition_at and returns undefined when none', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined),
    };
    const db = { selectFrom: vi.fn().mockReturnValue(chain) } as never;
    const at = new Date('2025-09-01T00:00:00Z');
    await expect(
      new DualGovernanceStateHistoryRepository(db).stateAt('dao-1', at),
    ).resolves.toBeUndefined();
    expect(chain.where).toHaveBeenCalledWith('transition_at', '<=', at);
  });
});
