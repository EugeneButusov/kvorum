import { describe, expect, it, vi } from 'vitest';
import { CompoundProposalRepository } from './compound-proposal-repository';

function makeDb(executeResult: unknown[] = []) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(executeResult),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    columns: vi.fn().mockReturnThis(),
    expression: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({ numUpdatedRows: 1n }),
  };

  const db = {
    selectFrom: vi.fn(() => chain),
    updateTable: vi.fn(() => chain),
    insertInto: vi.fn(() => chain),
  };

  return { db, chain };
}

const BOUND = { chainId: '0x1', confirmedThresholdBlock: '1000' };

describe('CompoundProposalRepository', () => {
  describe('findStaleForReconciliation', () => {
    it('returns [] without querying when sourceTypes is empty', async () => {
      const { db } = makeDb();
      const repo = new CompoundProposalRepository(db as never);

      const result = await repo.findStaleForReconciliation([], [BOUND], 100, 50);

      expect(result).toEqual([]);
      expect(db.selectFrom).not.toHaveBeenCalled();
    });

    it('returns [] without querying when perChainBounds is empty', async () => {
      const { db } = makeDb();
      const repo = new CompoundProposalRepository(db as never);

      const result = await repo.findStaleForReconciliation(
        ['compound_governor_bravo'],
        [],
        100,
        50,
      );

      expect(result).toEqual([]);
      expect(db.selectFrom).not.toHaveBeenCalled();
    });

    it('returns [] without querying when limit is zero', async () => {
      const { db } = makeDb();
      const repo = new CompoundProposalRepository(db as never);

      const result = await repo.findStaleForReconciliation(
        ['compound_governor_bravo'],
        [BOUND],
        100,
        0,
      );

      expect(result).toEqual([]);
      expect(db.selectFrom).not.toHaveBeenCalled();
    });

    it('executes query and returns rows when all args are valid', async () => {
      const rows = [{ id: 'p1', state: 'pending' }];
      const { db, chain } = makeDb(rows);
      const repo = new CompoundProposalRepository(db as never);

      const result = await repo.findStaleForReconciliation(
        ['compound_governor_bravo'],
        [BOUND],
        7_200,
        50,
      );

      expect(db.selectFrom).toHaveBeenCalledWith('proposal');
      expect(chain.execute).toHaveBeenCalled();
      expect(result).toBe(rows);
    });
  });

  describe('reconcileState', () => {
    it('returns the number of updated rows', async () => {
      const { db, chain } = makeDb();
      chain.executeTakeFirst.mockResolvedValue({ numUpdatedRows: 1n });
      const repo = new CompoundProposalRepository(db as never);

      const count = await repo.reconcileState({
        proposalId: 'p1',
        expectedStates: ['pending', 'active'],
        targetState: 'defeated',
        stateUpdatedAt: new Date('2026-01-01'),
      });

      expect(db.updateTable).toHaveBeenCalledWith('proposal');
      expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ state: 'defeated' }));
      expect(count).toBe(1);
    });

    it('returns 0 when the state guard prevents the update', async () => {
      const { db, chain } = makeDb();
      chain.executeTakeFirst.mockResolvedValue({ numUpdatedRows: 0n });
      const repo = new CompoundProposalRepository(db as never);

      const count = await repo.reconcileState({
        proposalId: 'p1',
        expectedStates: ['pending'],
        targetState: 'defeated',
        stateUpdatedAt: new Date('2026-01-01'),
      });

      expect(count).toBe(0);
    });
  });

  describe('markReconcileChecked', () => {
    it('upserts last_reconcile_check_block for the given proposal', async () => {
      const { db, chain } = makeDb();
      const repo = new CompoundProposalRepository(db as never);

      await repo.markReconcileChecked('p1', '1000');

      expect(db.insertInto).toHaveBeenCalledWith('compound_proposal_meta');
      expect(chain.values).toHaveBeenCalledWith({
        proposal_id: 'p1',
        last_reconcile_check_block: '1000',
      });
      expect(chain.onConflict).toHaveBeenCalled();
    });
  });

  describe('upsertQueuedAtBlock', () => {
    it('inserts queued_at_block resolved from proposal table via SELECT subquery', async () => {
      const { db, chain } = makeDb();
      const repo = new CompoundProposalRepository(db as never);

      await repo.upsertQueuedAtBlock('dao-1', 'compound_governor_bravo', '42', '500');

      expect(db.insertInto).toHaveBeenCalledWith('compound_proposal_meta');
      expect(chain.columns).toHaveBeenCalledWith(['proposal_id', 'queued_at_block']);
      expect(chain.expression).toHaveBeenCalledWith(expect.any(Function));
      expect(chain.onConflict).toHaveBeenCalled();
    });

    it('expression callback selects from proposal with correct filters', async () => {
      const { db, chain } = makeDb();
      const repo = new CompoundProposalRepository(db as never);

      let capturedCallback: ((eb: unknown) => unknown) | undefined;
      chain.expression.mockImplementation((cb: (eb: unknown) => unknown) => {
        capturedCallback = cb;
        return chain;
      });

      await repo.upsertQueuedAtBlock('dao-1', 'compound_governor_bravo', '42', '500');

      expect(capturedCallback).toBeDefined();

      // Invoke the callback with a mock expression builder to verify the subquery shape
      const selectChain = {
        selectFrom: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      };
      const eb = { selectFrom: vi.fn(() => selectChain), val: vi.fn(() => ({ as: vi.fn() })) };
      capturedCallback!(eb);

      expect(eb.selectFrom).toHaveBeenCalledWith('proposal');
      expect(selectChain.where).toHaveBeenCalledWith('dao_id', '=', 'dao-1');
      expect(selectChain.where).toHaveBeenCalledWith('source_type', '=', 'compound_governor_bravo');
      expect(selectChain.where).toHaveBeenCalledWith('source_id', '=', '42');
    });
  });
});
