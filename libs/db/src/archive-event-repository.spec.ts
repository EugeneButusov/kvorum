import { describe, expect, it, vi } from 'vitest';
import { ArchiveEventRepository } from './archive-event-repository';
import type { NewArchiveEvent } from './schema/pg';

function makeSelectChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst,
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  const selectFrom = vi.fn().mockReturnValue(chain);
  return { selectFrom, ...chain };
}

/** Captures the column set passed to the ON CONFLICT target so the per-shape branch can be asserted. */
function makeInsertChain() {
  const executeTakeFirst = vi.fn().mockResolvedValue({ id: 'new-id' });
  const returning = vi.fn().mockReturnValue({ executeTakeFirst });
  let conflictColumns: readonly string[] | undefined;
  const oc = {
    columns: vi.fn(),
    where: vi.fn(),
    doNothing: vi.fn(),
  };
  oc.columns.mockImplementation((cols: readonly string[]) => {
    conflictColumns = cols;
    return oc;
  });
  oc.where.mockReturnValue(oc);
  oc.doNothing.mockReturnValue(oc);
  const onConflict = vi.fn().mockImplementation((cb: (b: typeof oc) => unknown) => {
    cb(oc);
    return { returning };
  });
  const values = vi.fn().mockReturnValue({ onConflict });
  const insertInto = vi.fn().mockReturnValue({ values });
  return { insertInto, oc, getConflictColumns: () => conflictColumns };
}

const EVM_ROW: NewArchiveEvent = {
  source_type: 'evm_source',
  dao_source_id: 'src-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derived_at: null,
};

const OFFCHAIN_ROW: NewArchiveEvent = {
  source_type: 'offchain_source',
  dao_source_id: 'src-2',
  chain_id: 'off-chain',
  external_id: 'proposal-0xabc',
  event_type: 'ProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derived_at: null,
};

describe('ArchiveEventRepository', () => {
  it('find() restricts to EVM rows (external_id IS NULL) and the 4-tuple', async () => {
    const pg = makeSelectChain({ id: 'evm-1' });
    const repo = new ArchiveEventRepository({ selectFrom: pg.selectFrom } as never);

    await expect(
      repo.find({
        sourceType: 'evm_source',
        chainId: '0x1',
        txHash: '0xtx',
        logIndex: 1,
      }),
    ).resolves.toEqual({ id: 'evm-1' });

    expect(pg.where).toHaveBeenCalledWith('external_id', 'is', null);
    expect(pg.where).toHaveBeenCalledWith('tx_hash', '=', '0xtx');
    expect(pg.where).toHaveBeenCalledWith('log_index', '=', 1);
  });

  it('findByExternalId() keys on source_type + chain_id + external_id', async () => {
    const pg = makeSelectChain({ id: 'off-1' });
    const repo = new ArchiveEventRepository({ selectFrom: pg.selectFrom } as never);

    await expect(
      repo.findByExternalId({
        sourceType: 'offchain_source',
        chainId: 'off-chain',
        externalId: 'proposal-0xabc',
      }),
    ).resolves.toEqual({ id: 'off-1' });

    expect(pg.where).toHaveBeenCalledWith('source_type', '=', 'offchain_source');
    expect(pg.where).toHaveBeenCalledWith('chain_id', '=', 'off-chain');
    expect(pg.where).toHaveBeenCalledWith('external_id', '=', 'proposal-0xabc');
  });

  it('insert() targets the EVM 4-tuple index for an EVM row', async () => {
    const pg = makeInsertChain();
    const repo = new ArchiveEventRepository({ insertInto: pg.insertInto } as never);

    await repo.insert(EVM_ROW);

    expect(pg.getConflictColumns()).toEqual(['source_type', 'chain_id', 'tx_hash', 'log_index']);
    expect(pg.oc.where).toHaveBeenCalledWith('external_id', 'is', null);
  });

  it('insert() targets the external_id index for an off-chain row', async () => {
    const pg = makeInsertChain();
    const repo = new ArchiveEventRepository({ insertInto: pg.insertInto } as never);

    await repo.insert(OFFCHAIN_ROW);

    expect(pg.getConflictColumns()).toEqual(['source_type', 'chain_id', 'external_id']);
    expect(pg.oc.where).toHaveBeenCalledWith('external_id', 'is not', null);
  });
});
