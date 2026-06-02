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
  const where = vi.fn();
  const chain = { set: vi.fn(), where, execute };
  chain.set.mockReturnValue(chain);
  where.mockReturnValue(chain);
  const updateTable = vi.fn().mockReturnValue(chain);

  return { updateTable, set: chain.set, where, execute };
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
    });
    expect(insert.capturedColumns).toEqual(['proposal_id', 'payload_index']);
    expect(insert.execute).toHaveBeenCalledOnce();
  });
});
