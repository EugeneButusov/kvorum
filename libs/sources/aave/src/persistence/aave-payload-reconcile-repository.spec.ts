import { describe, expect, it, vi } from 'vitest';
import { AavePayloadReconcileRepository } from './aave-payload-reconcile-repository';

function makeSelectChain(executeResult: unknown[] = []) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(executeResult),
  };
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { selectFrom, chain };
}

function makeUpdateChain(updatedRows = 1n) {
  const execute = vi.fn().mockResolvedValue(undefined);
  const executeTakeFirst = vi.fn().mockResolvedValue({ numUpdatedRows: updatedRows });
  const where = vi.fn();
  const chain = { set: vi.fn(), where, execute, executeTakeFirst };
  chain.set.mockReturnValue(chain);
  where.mockReturnValue(chain);
  const updateTable = vi.fn().mockReturnValue(chain);
  return { updateTable, set: chain.set, where, execute, executeTakeFirst };
}

describe('AavePayloadReconcileRepository', () => {
  it('finds stale created and queued payload rows for reconciliation', async () => {
    const select = makeSelectChain([{ id: 'payload-row-1', chain_id: '0xa' }]);
    const repo = new AavePayloadReconcileRepository({ selectFrom: select.selectFrom } as never);

    const result = await repo.findStaleForReconciliation(
      ['aave_payloads_controller'],
      [{ chainId: '0xa', confirmedThresholdBlock: '1000', recheckGapBlocks: 600 }],
      25,
    );

    expect(select.selectFrom).toHaveBeenCalledWith('aave_proposal_payload');
    expect(select.chain.where).toHaveBeenCalledWith('status', 'in', ['created', 'queued']);
    expect(select.chain.where).toHaveBeenCalledWith('unindexed_target_chain', '=', false);
    expect(select.chain.limit).toHaveBeenCalledWith(25);
    expect(result).toEqual([{ id: 'payload-row-1', chain_id: '0xa' }]);
  });

  it('returns [] without querying when reconciliation inputs are empty', async () => {
    const select = makeSelectChain();
    const repo = new AavePayloadReconcileRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.findStaleForReconciliation([], [], 25)).resolves.toEqual([]);
    await expect(
      repo.findStaleForReconciliation(['aave_payloads_controller'], [], 25),
    ).resolves.toEqual([]);
    await expect(
      repo.findStaleForReconciliation(
        ['aave_payloads_controller'],
        [{ chainId: '0xa', confirmedThresholdBlock: '1000', recheckGapBlocks: 600 }],
        0,
      ),
    ).resolves.toEqual([]);
    expect(select.selectFrom).not.toHaveBeenCalled();
  });

  it('expires payload rows only from created or queued', async () => {
    const update = makeUpdateChain();
    const repo = new AavePayloadReconcileRepository({ updateTable: update.updateTable } as never);

    await expect(repo.expirePayload('payload-row-1')).resolves.toBe(1);

    expect(update.updateTable).toHaveBeenCalledWith('aave_proposal_payload');
    expect(update.set).toHaveBeenCalledWith({ status: 'expired' });
    expect(update.where.mock.calls).toEqual([
      ['id', '=', 'payload-row-1'],
      ['status', 'in', ['created', 'queued']],
    ]);
  });

  it('marks payload reconcile watermark on payload rows', async () => {
    const update = makeUpdateChain();
    const repo = new AavePayloadReconcileRepository({ updateTable: update.updateTable } as never);

    await repo.markPayloadReconcileChecked('payload-row-1', '1000');

    expect(update.updateTable).toHaveBeenCalledWith('aave_proposal_payload');
    expect(update.set).toHaveBeenCalledWith({ last_reconcile_check_block: '1000' });
    expect(update.where).toHaveBeenCalledWith('id', '=', 'payload-row-1');
    expect(update.execute).toHaveBeenCalledOnce();
  });
});
