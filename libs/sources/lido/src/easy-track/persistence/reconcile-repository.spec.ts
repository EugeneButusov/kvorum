import { describe, expect, it, vi } from 'vitest';
import { EasyTrackReconcileRepository } from './reconcile-repository';

// findStaleForReconciliation is a multi-join query exercised against real PG in the reconcile
// integration spec (marked v8-ignore in source); the unit spec covers the two mutation methods.
function makeUpdateChain() {
  const calls: { set?: unknown; where: unknown[][] } = { where: [] };
  const executeTakeFirst = vi.fn().mockResolvedValue({ numUpdatedRows: 1n });
  const execute = vi.fn().mockResolvedValue(undefined);
  const chain = {
    set: vi.fn().mockImplementation((v: unknown) => {
      calls.set = v;
      return chain;
    }),
    where: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.where.push(args);
      return chain;
    }),
    executeTakeFirst,
    execute,
  };
  const updateTable = vi.fn().mockReturnValue(chain);
  return { db: { updateTable } as never, updateTable, chain, calls };
}

describe('EasyTrackReconcileRepository', () => {
  it('findStaleForReconciliation returns [] for empty inputs (no query)', async () => {
    const repo = new EasyTrackReconcileRepository({} as never);
    const bound = { chainId: '0x1', confirmedThresholdBlock: '100', recheckGapBlocks: 10 };
    await expect(repo.findStaleForReconciliation([], [], 0)).resolves.toEqual([]);
    await expect(repo.findStaleForReconciliation(['easy_track'], [], 10)).resolves.toEqual([]);
    await expect(repo.findStaleForReconciliation(['easy_track'], [bound], 0)).resolves.toEqual([]);
  });

  it('reconcileState guards on expected states and returns the updated row count', async () => {
    const { db, updateTable, calls } = makeUpdateChain();
    const repo = new EasyTrackReconcileRepository(db);
    const n = await repo.reconcileState({
      proposalId: 'p-1',
      expectedStates: ['active'],
      targetState: 'queued',
      stateUpdatedAt: new Date('2026-01-04T00:00:00Z'),
    });
    expect(updateTable).toHaveBeenCalledWith('proposal');
    expect(calls.set).toEqual(expect.objectContaining({ state: 'queued' }));
    expect(calls.where).toEqual([
      ['id', '=', 'p-1'],
      ['state', 'in', ['active']],
      ['state', '<>', 'queued'],
    ]);
    expect(n).toBe(1);
  });

  it('reconcileState returns 0 when the guard rejects (no rows updated)', async () => {
    const { db, chain } = makeUpdateChain();
    (chain.executeTakeFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ numUpdatedRows: 0n });
    const repo = new EasyTrackReconcileRepository(db);
    const n = await repo.reconcileState({
      proposalId: 'p-1',
      expectedStates: ['active'],
      targetState: 'queued',
      stateUpdatedAt: new Date(),
    });
    expect(n).toBe(0);
  });

  it('reconcileState returns 0 when the driver yields no result row', async () => {
    const { db, chain } = makeUpdateChain();
    (chain.executeTakeFirst as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const repo = new EasyTrackReconcileRepository(db);
    await expect(
      repo.reconcileState({
        proposalId: 'p-1',
        expectedStates: ['active'],
        targetState: 'queued',
        stateUpdatedAt: new Date(),
      }),
    ).resolves.toBe(0);
  });

  it('markReconcileChecked writes the watermark on easy_track_motion_meta', async () => {
    const { db, updateTable, calls } = makeUpdateChain();
    const repo = new EasyTrackReconcileRepository(db);
    await repo.markReconcileChecked('p-1', '13700000');
    expect(updateTable).toHaveBeenCalledWith('easy_track_motion_meta');
    expect(calls.set).toEqual({ last_reconcile_check_block: '13700000' });
    expect(calls.where).toEqual([['proposal_id', '=', 'p-1']]);
  });
});
