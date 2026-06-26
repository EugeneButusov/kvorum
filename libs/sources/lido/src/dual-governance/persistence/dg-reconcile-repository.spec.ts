import { describe, expect, it, vi } from 'vitest';
import { DualGovernanceReconcileRepository } from './dg-reconcile-repository';

const BOUND = { chainId: '0x1', confirmedThresholdBlock: '988', recheckGapBlocks: 10 };

describe('DualGovernanceReconcileRepository', () => {
  it('findStaleForReconciliation short-circuits to [] on empty inputs (no query)', async () => {
    const db = { selectFrom: vi.fn() } as never;
    const repo = new DualGovernanceReconcileRepository(db);

    await expect(repo.findStaleForReconciliation([], [BOUND], 10)).resolves.toEqual([]);
    await expect(repo.findStaleForReconciliation(['dual_governance'], [], 10)).resolves.toEqual([]);
    await expect(repo.findStaleForReconciliation(['dual_governance'], [BOUND], 0)).resolves.toEqual(
      [],
    );
    expect((db as { selectFrom: ReturnType<typeof vi.fn> }).selectFrom).not.toHaveBeenCalled();
  });

  it('markReconcileChecked lazily upserts the cursor + last effective state', async () => {
    const onConflict = {
      column: vi.fn().mockReturnThis(),
      doUpdateSet: vi.fn().mockReturnThis(),
    };
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockImplementation((cb: (b: typeof onConflict) => unknown) => {
        cb(onConflict);
        return chain;
      }),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const db = { insertInto: vi.fn().mockReturnValue(chain) } as never;

    await new DualGovernanceReconcileRepository(db).markReconcileChecked('dao-1', '988', 'normal');

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        dao_id: 'dao-1',
        last_reconcile_check_block: '988',
        last_effective_state: 'normal',
      }),
    );
    expect(onConflict.column).toHaveBeenCalledWith('dao_id');
    expect(onConflict.doUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        last_reconcile_check_block: '988',
        last_effective_state: 'normal',
      }),
    );
  });

  it('markReconcileChecked tolerates a null effective state (unmapped NotInitialized)', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const db = { insertInto: vi.fn().mockReturnValue(chain) } as never;
    await new DualGovernanceReconcileRepository(db).markReconcileChecked('dao-1', '988', null);
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ last_effective_state: null }),
    );
  });
});
