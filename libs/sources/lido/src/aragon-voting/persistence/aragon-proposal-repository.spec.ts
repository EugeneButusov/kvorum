import { describe, expect, it, vi } from 'vitest';
import { AragonProposalRepository } from './aragon-proposal-repository';

describe('AragonProposalRepository', () => {
  it('insertMetadata inserts with ON CONFLICT (proposal_id) DO NOTHING', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const onConflict = vi.fn((cb: (oc: unknown) => unknown) => {
      cb({ column: () => ({ doNothing: () => undefined }) });
      return { execute };
    });
    const values = vi.fn().mockReturnValue({ onConflict });
    const insertInto = vi.fn().mockReturnValue({ values });
    const repo = new AragonProposalRepository({ insertInto } as never);

    await repo.insertMetadata({ proposal_id: 'p1', app_address: '0xabc' } as never);

    expect(insertInto).toHaveBeenCalledWith('aragon_proposal_metadata');
    expect(values).toHaveBeenCalledWith({ proposal_id: 'p1', app_address: '0xabc' });
    expect(onConflict).toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it('setExecutedAt updates executed_at for the proposal', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });
    const repo = new AragonProposalRepository({ updateTable } as never);

    const ts = new Date('2026-02-02T00:00:00Z');
    await repo.setExecutedAt('p1', ts);

    expect(updateTable).toHaveBeenCalledWith('aragon_proposal_metadata');
    expect(set).toHaveBeenCalledWith({ executed_at: ts });
    expect(where).toHaveBeenCalledWith('proposal_id', '=', 'p1');
    expect(execute).toHaveBeenCalled();
  });

  it('findVotingAddress reads the voting_address from dao_source config', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ voting_address: '0xdef' });
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const select = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new AragonProposalRepository({ selectFrom } as never);

    expect(await repo.findVotingAddress('s1')).toBe('0xdef');
    expect(selectFrom).toHaveBeenCalledWith('dao_source');
    expect(where).toHaveBeenCalledWith('id', '=', 's1');
  });

  it('findVotingAddress returns undefined when config has no address', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ voting_address: null });
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const select = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new AragonProposalRepository({ selectFrom } as never);

    expect(await repo.findVotingAddress('s1')).toBeUndefined();
  });

  it('reconcileState writes the guarded state transition and returns the row count', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ numUpdatedRows: 1n });
    const chain: Record<string, unknown> = { executeTakeFirst };
    chain['set'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => chain);
    const updateTable = vi.fn().mockReturnValue(chain);
    const repo = new AragonProposalRepository({ updateTable } as never);

    const n = await repo.reconcileState({
      proposalId: 'p1',
      expectedStates: ['active'],
      targetState: 'succeeded',
      stateUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(n).toBe(1);
    expect(updateTable).toHaveBeenCalledWith('proposal');
    expect(chain['set']).toHaveBeenCalledWith(expect.objectContaining({ state: 'succeeded' }));
  });

  it('markReconcileChecked stamps last_reconcile_check_block', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });
    const repo = new AragonProposalRepository({ updateTable } as never);

    await repo.markReconcileChecked('p1', '18500000');

    expect(updateTable).toHaveBeenCalledWith('aragon_proposal_metadata');
    expect(set).toHaveBeenCalledWith({ last_reconcile_check_block: '18500000' });
    expect(where).toHaveBeenCalledWith('proposal_id', '=', 'p1');
  });

  it('findStaleForReconciliation short-circuits on empty inputs (no query)', async () => {
    const selectFrom = vi.fn();
    const repo = new AragonProposalRepository({ selectFrom } as never);

    expect(
      await repo.findStaleForReconciliation(
        [],
        [{ chainId: '0x1', confirmedThresholdBlock: '1', recheckGapBlocks: 1 }],
        5,
      ),
    ).toEqual([]);
    expect(await repo.findStaleForReconciliation(['aragon_voting'], [], 5)).toEqual([]);
    expect(
      await repo.findStaleForReconciliation(
        ['aragon_voting'],
        [{ chainId: '0x1', confirmedThresholdBlock: '1', recheckGapBlocks: 1 }],
        0,
      ),
    ).toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it('fillSupportQuorum updates the metadata row (COALESCE write-once)', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });
    const repo = new AragonProposalRepository({ updateTable } as never);

    await repo.fillSupportQuorum('p1', { supportRequiredPct: '5', minAcceptQuorumPct: '1' });

    expect(updateTable).toHaveBeenCalledWith('aragon_proposal_metadata');
    expect(where).toHaveBeenCalledWith('proposal_id', '=', 'p1');
  });
});
