import { describe, expect, it, vi } from 'vitest';
import { AaveProposalRepository } from './aave-proposal-repository';

function makeInsertChain() {
  let capturedValues: unknown;
  let capturedColumn: string | undefined;
  let capturedColumns: readonly string[] | undefined;
  const execute = vi.fn().mockResolvedValue(undefined);
  const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictBuilder) => unknown) => {
    fn({
      column: (column) => {
        capturedColumn = column;
        return { doNothing: () => ({ execute }) };
      },
      columns: (columns) => {
        capturedColumns = columns;
        return { doNothing: () => ({ execute }) };
      },
    });
    return { execute };
  });
  const values = vi.fn().mockImplementation((value: unknown) => {
    capturedValues = value;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });

  return {
    insertInto,
    execute,
    get capturedValues() {
      return capturedValues;
    },
    get capturedColumn() {
      return capturedColumn;
    },
    get capturedColumns() {
      return capturedColumns;
    },
  };
}

function makeUpdateChain() {
  const execute = vi.fn().mockResolvedValue(undefined);
  const executeTakeFirst = vi.fn().mockResolvedValue({ numUpdatedRows: 1n });
  const where = vi.fn();
  const chain = { set: vi.fn(), where, execute, executeTakeFirst };
  chain.set.mockReturnValue(chain);
  where.mockReturnValue(chain);
  const updateTable = vi.fn().mockReturnValue(chain);

  return { updateTable, set: chain.set, where, execute, executeTakeFirst };
}

function makeSelectChain(executeResult: unknown[] = []) {
  const chain = {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(executeResult),
  };
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { selectFrom, chain };
}

function makeSelectTakeFirstChain(executeResult: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(executeResult),
  };
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { selectFrom, chain };
}

interface ConflictBuilder {
  column(column: string): { doNothing(): unknown };
  columns(columns: readonly string[]): { doNothing(): unknown };
}

describe('AaveProposalRepository', () => {
  it('inserts metadata with proposal_id conflict handling', async () => {
    const insert = makeInsertChain();
    const repo = new AaveProposalRepository({ insertInto: insert.insertInto } as never);

    await repo.insertMetadata({
      proposal_id: 'proposal-1',
      voting_chain_id: null,
      voting_machine_address: null,
      voting_strategy_address: null,
      snapshot_block_hash: null,
      snapshot_block_number_l1: null,
      creation_block: '123',
    });

    expect(insert.insertInto).toHaveBeenCalledWith('aave_proposal_metadata');
    expect(insert.capturedValues).toEqual({
      proposal_id: 'proposal-1',
      voting_chain_id: null,
      voting_machine_address: null,
      voting_strategy_address: null,
      snapshot_block_hash: null,
      snapshot_block_number_l1: null,
      creation_block: '123',
    });
    expect(insert.capturedColumn).toBe('proposal_id');
    expect(insert.execute).toHaveBeenCalledOnce();
  });

  it('updates snapshot block hash by proposal id', async () => {
    const update = makeUpdateChain();
    const repo = new AaveProposalRepository({ updateTable: update.updateTable } as never);

    await repo.setSnapshotBlockHash('proposal-1', '0xhash');

    expect(update.updateTable).toHaveBeenCalledWith('aave_proposal_metadata');
    expect(update.set).toHaveBeenCalledWith({ snapshot_block_hash: '0xhash' });
    expect(update.where).toHaveBeenCalledWith('proposal_id', '=', 'proposal-1');
    expect(update.execute).toHaveBeenCalledOnce();
  });

  it('sets voting chain binding only when metadata is still unbound', async () => {
    const update = makeUpdateChain();
    const repo = new AaveProposalRepository({ updateTable: update.updateTable } as never);

    await repo.setVotingChainBinding('proposal-1', {
      votingChainId: '0x89',
      votingMachineAddress: '0x' + '11'.repeat(20),
    });

    expect(update.updateTable).toHaveBeenCalledWith('aave_proposal_metadata');
    expect(update.set).toHaveBeenCalledWith({
      voting_chain_id: '0x89',
      voting_machine_address: '0x' + '11'.repeat(20),
    });
    expect(update.where).toHaveBeenCalledWith('proposal_id', '=', 'proposal-1');
    expect(update.where).toHaveBeenCalledWith('voting_chain_id', 'is', null);
    expect(update.execute).toHaveBeenCalledOnce();
  });

  it('reads voting machine address from dao_source config', async () => {
    const select = makeSelectTakeFirstChain({
      voting_machine_address: '0x' + '22'.repeat(20),
    });
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.findVotingMachineAddress('source-1')).resolves.toBe('0x' + '22'.repeat(20));
    expect(select.selectFrom).toHaveBeenCalledWith('dao_source');
    expect(select.chain.where).toHaveBeenCalledWith('id', '=', 'source-1');
  });

  it('returns undefined when dao_source has no voting machine address', async () => {
    const select = makeSelectTakeFirstChain(undefined);
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.findVotingMachineAddress('source-1')).resolves.toBeUndefined();
  });

  it('reads payloads controller address from dao_source config', async () => {
    const select = makeSelectTakeFirstChain({
      payloads_controller_address: '0x' + '33'.repeat(20),
    });
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.findPayloadsControllerAddress('source-1')).resolves.toBe(
      '0x' + '33'.repeat(20),
    );
    expect(select.selectFrom).toHaveBeenCalledWith('dao_source');
    expect(select.chain.where).toHaveBeenCalledWith('id', '=', 'source-1');
  });

  it('detects when a payload-controller source exists for a target chain', async () => {
    const select = makeSelectTakeFirstChain({ present: true });
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.hasActivePayloadsControllerSource('dao-1', '0xa')).resolves.toBe(true);
    expect(select.selectFrom).toHaveBeenCalledWith('dao_source');
    expect(select.chain.where.mock.calls).toEqual([
      ['dao_id', '=', 'dao-1'],
      ['source_type', '=', 'aave_payloads_controller'],
      ['chain_id', '=', '0xa'],
    ]);
  });

  it('returns false when a payload-controller source is absent for a target chain', async () => {
    const select = makeSelectTakeFirstChain(undefined);
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.hasActivePayloadsControllerSource('dao-1', '0xa')).resolves.toBe(false);
  });

  it('finds a declared payload by target chain, controller, and payload id', async () => {
    const select = makeSelectTakeFirstChain({
      id: 'payload-row-1',
      proposal_id: 'proposal-1',
      payload_index: 2,
      status: 'created',
    });
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(
      repo.findDeclaredPayload({
        targetChainId: '0xa',
        payloadsControllerAddress: '0xABCDEF',
        payloadId: '17',
      }),
    ).resolves.toEqual({
      id: 'payload-row-1',
      proposal_id: 'proposal-1',
      payload_index: 2,
      status: 'created',
    });

    expect(select.selectFrom).toHaveBeenCalledWith('aave_proposal_payload');
    expect(select.chain.where.mock.calls).toEqual([
      ['target_chain_id', '=', '0xa'],
      ['payloads_controller_address', '=', '0xabcdef'],
      ['payload_id', '=', '17'],
    ]);
  });

  it('returns undefined when a declared payload is absent', async () => {
    const select = makeSelectTakeFirstChain(undefined);
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(
      repo.findDeclaredPayload({
        targetChainId: '0xa',
        payloadsControllerAddress: '0xabcdef',
        payloadId: '17',
      }),
    ).resolves.toBeUndefined();
  });

  it('finds stale rows for reconciliation when source types, bounds, and limit are valid', async () => {
    const select = makeSelectChain([{ id: 'proposal-1', state: 'active' }]);
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    const result = await repo.findStaleForReconciliation(
      ['aave_governance_v3'],
      [{ chainId: '0x1', confirmedThresholdBlock: '1000', recheckGapBlocks: 600 }],
      50,
    );

    expect(select.selectFrom).toHaveBeenCalledWith('proposal');
    expect(select.chain.execute).toHaveBeenCalledOnce();
    expect(result).toEqual([{ id: 'proposal-1', state: 'active' }]);
    expect(select.chain.innerJoin).toHaveBeenCalledTimes(2);
    expect(select.chain.where).toHaveBeenCalledWith('proposal.source_type', 'in', [
      'aave_governance_v3',
    ]);
    expect(select.chain.where).toHaveBeenCalledWith('proposal.state', 'in', [
      'pending',
      'active',
      'queued',
    ]);
    expect(select.chain.limit).toHaveBeenCalledWith(50);
  });

  it('returns [] without querying when findStaleForReconciliation inputs are empty', async () => {
    const select = makeSelectChain();
    const repo = new AaveProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.findStaleForReconciliation([], [], 50)).resolves.toEqual([]);
    await expect(repo.findStaleForReconciliation(['aave_governance_v3'], [], 50)).resolves.toEqual(
      [],
    );
    await expect(
      repo.findStaleForReconciliation(
        ['aave_governance_v3'],
        [{ chainId: '0x1', confirmedThresholdBlock: '1000', recheckGapBlocks: 600 }],
        0,
      ),
    ).resolves.toEqual([]);
    expect(select.selectFrom).not.toHaveBeenCalled();
  });

  it('reconciles proposal state and returns updated row count', async () => {
    const update = makeUpdateChain();
    const repo = new AaveProposalRepository({ updateTable: update.updateTable } as never);

    const count = await repo.reconcileState({
      proposalId: 'proposal-1',
      expectedStates: ['pending', 'active', 'queued'],
      targetState: 'expired',
      stateUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(update.updateTable).toHaveBeenCalledWith('proposal');
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'expired',
        state_updated_at: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    expect(count).toBe(1);
  });

  it('advances payload status monotonically and returns updated row count', async () => {
    const update = makeUpdateChain();
    const repo = new AaveProposalRepository({ updateTable: update.updateTable } as never);

    await expect(
      repo.advancePayloadStatus({
        id: 'payload-row-1',
        targetStatus: 'queued',
        allowedFrom: ['declared', 'created'],
      }),
    ).resolves.toBe(1);

    expect(update.updateTable).toHaveBeenCalledWith('aave_proposal_payload');
    expect(update.set).toHaveBeenCalledWith({
      status: 'queued',
      executed_at_destination: undefined,
    });
    expect(update.where.mock.calls).toEqual([
      ['id', '=', 'payload-row-1'],
      ['status', 'in', ['declared', 'created']],
      ['status', '<>', 'queued'],
    ]);
  });

  it('stores executed_at_destination when advancing to executed', async () => {
    const update = makeUpdateChain();
    const repo = new AaveProposalRepository({ updateTable: update.updateTable } as never);
    const executedAt = new Date('2026-01-01T00:00:00Z');

    await repo.advancePayloadStatus({
      id: 'payload-row-1',
      targetStatus: 'executed',
      allowedFrom: ['declared', 'created', 'queued'],
      executedAtDestination: executedAt,
    });

    expect(update.set).toHaveBeenCalledWith({
      status: 'executed',
      executed_at_destination: executedAt,
    });
  });

  it('marks reconcile watermark on metadata rows', async () => {
    const update = makeUpdateChain();
    const repo = new AaveProposalRepository({ updateTable: update.updateTable } as never);

    await repo.markReconcileChecked('proposal-1', '1000');

    expect(update.updateTable).toHaveBeenCalledWith('aave_proposal_metadata');
    expect(update.set).toHaveBeenCalledWith({ last_reconcile_check_block: '1000' });
    expect(update.where).toHaveBeenCalledWith('proposal_id', '=', 'proposal-1');
    expect(update.execute).toHaveBeenCalledOnce();
  });

  it('inserts declared payloads idempotently by proposal_id and payload_index', async () => {
    const insert = makeInsertChain();
    const repo = new AaveProposalRepository({ insertInto: insert.insertInto } as never);

    await repo.insertDeclaredPayload({
      proposal_id: 'proposal-1',
      payload_index: 0,
      target_chain_id: '0xa',
      payloads_controller_address: '0xcontroller',
      payload_id: '17',
      status: 'declared',
      executed_at_destination: null,
      bridge_message_id: null,
      unindexed_target_chain: true,
    });

    expect(insert.insertInto).toHaveBeenCalledWith('aave_proposal_payload');
    expect(insert.capturedValues).toEqual({
      proposal_id: 'proposal-1',
      payload_index: 0,
      target_chain_id: '0xa',
      payloads_controller_address: '0xcontroller',
      payload_id: '17',
      status: 'declared',
      executed_at_destination: null,
      bridge_message_id: null,
      unindexed_target_chain: true,
    });
    expect(insert.capturedColumns).toEqual(['proposal_id', 'payload_index']);
    expect(insert.execute).toHaveBeenCalledOnce();
  });
});
