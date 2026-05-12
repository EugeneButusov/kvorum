import { describe, it, expect, vi } from 'vitest';
import { ReorgEventRepository } from './reorg-event-repository';
import type { ReorgWriteInput } from './reorg-event-repository';

const BASE_INPUT: ReorgWriteInput = {
  chainId: 1,
  detectedAt: new Date('2026-01-01T00:00:00Z'),
  divergenceBlockNumber: 20_000_000n,
  orphanedBlockHashes: ['0xaaa', '0xbbb'],
  canonicalBlockHashes: ['0xccc', '0xddd'],
  notes: null,
};

function makeTrxChain(opts: {
  insertId?: string;
  insertThrows?: unknown;
  updateRows?: bigint;
  updateThrows?: unknown;
}) {
  const insertExecute = opts.insertThrows
    ? vi.fn().mockRejectedValue(opts.insertThrows)
    : vi.fn().mockResolvedValue({ id: opts.insertId ?? 'reorg-uuid' });
  const insertReturning = vi.fn().mockReturnValue({ executeTakeFirstOrThrow: insertExecute });
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertInto = vi.fn().mockReturnValue({ values: insertValues });

  const updateExecute = opts.updateThrows
    ? vi.fn().mockRejectedValue(opts.updateThrows)
    : vi.fn().mockResolvedValue({ numUpdatedRows: opts.updateRows ?? 2n });
  const updateWhere3 = vi.fn().mockReturnValue({ executeTakeFirst: updateExecute });
  const updateWhere2 = vi.fn().mockReturnValue({ where: updateWhere3 });
  const updateWhere1 = vi.fn().mockReturnValue({ where: updateWhere2 });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere1 });
  const updateTable = vi.fn().mockReturnValue({ set: updateSet });

  const trx = { insertInto, updateTable };

  const txExecute = vi
    .fn()
    .mockImplementation(async (fn: (trx: typeof trx) => Promise<unknown>) => fn(trx));
  const transaction = vi.fn().mockReturnValue({ execute: txExecute });
  const pgDb = { transaction };

  return {
    pgDb,
    trx,
    insertInto,
    insertValues,
    insertReturning,
    insertExecute,
    updateTable,
    updateSet,
    updateWhere1,
    updateWhere2,
    updateWhere3,
    updateExecute,
  };
}

describe('ReorgEventRepository', () => {
  it('#1 — happy path: writes reorg_event + UPDATEs pending rows; returns correct result', async () => {
    const { pgDb, insertInto, updateTable } = makeTrxChain({ updateRows: 2n });
    const repo = new ReorgEventRepository(pgDb as never);
    const result = await repo.writeReorgEventAndOrphan(BASE_INPUT);

    expect(insertInto).toHaveBeenCalledWith('reorg_event');
    expect(updateTable).toHaveBeenCalledWith('archive_confirmation');
    expect(result).toEqual({ reorgEventId: 'reorg-uuid', orphanedRowCount: 2 });
  });

  it('#2 — empty orphanedBlockHashes: writes reorg_event only; skips UPDATE; orphanedRowCount = 0', async () => {
    const { pgDb, updateTable } = makeTrxChain({});
    const repo = new ReorgEventRepository(pgDb as never);
    const result = await repo.writeReorgEventAndOrphan({
      ...BASE_INPUT,
      orphanedBlockHashes: [],
    });

    expect(updateTable).not.toHaveBeenCalled();
    expect(result).toEqual({ reorgEventId: 'reorg-uuid', orphanedRowCount: 0 });
  });

  it('#3 — UPDATE matches zero rows: orphanedRowCount = 0, no error', async () => {
    const { pgDb } = makeTrxChain({ updateRows: 0n });
    const repo = new ReorgEventRepository(pgDb as never);
    const result = await repo.writeReorgEventAndOrphan(BASE_INPUT);
    expect(result.orphanedRowCount).toBe(0);
  });

  it('#4 — UPDATE sets only confirmation_status, orphaned_at, orphaned_by_reorg_event_id', async () => {
    const { pgDb, updateSet } = makeTrxChain({});
    const repo = new ReorgEventRepository(pgDb as never);
    await repo.writeReorgEventAndOrphan(BASE_INPUT);

    const setArg = updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(setArg)).toEqual([
      'confirmation_status',
      'orphaned_at',
      'orphaned_by_reorg_event_id',
    ]);
    expect(setArg['confirmation_status']).toBe('orphaned');
  });

  it('#5 — transaction rollback on UPDATE failure: rejects with the error', async () => {
    const updateErr = new Error('pg down');
    const { pgDb } = makeTrxChain({ updateThrows: updateErr });
    const repo = new ReorgEventRepository(pgDb as never);
    await expect(repo.writeReorgEventAndOrphan(BASE_INPUT)).rejects.toThrow('pg down');
  });

  it('#6 — chain_id filter present on the UPDATE WHERE', async () => {
    const { pgDb, updateWhere1 } = makeTrxChain({});
    const repo = new ReorgEventRepository(pgDb as never);
    await repo.writeReorgEventAndOrphan({ ...BASE_INPUT, chainId: 42 });

    expect(updateWhere1).toHaveBeenCalledWith('chain_id', '=', 42);
  });

  it('#7 — divergenceBlockNumber is bigint at API, serialized as string in insert', async () => {
    const { pgDb, insertValues } = makeTrxChain({});
    const repo = new ReorgEventRepository(pgDb as never);
    await repo.writeReorgEventAndOrphan({ ...BASE_INPUT, divergenceBlockNumber: 99_999_999n });

    const inserted = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted['divergence_block_number']).toBe('99999999');
  });

  it('#8 — notes field round-trips: null / truncated / chain_shrunk / both', async () => {
    const cases: Array<[string | null]> = [
      [null],
      ['truncated'],
      ['chain_shrunk'],
      ['truncated;chain_shrunk'],
    ];
    for (const [notes] of cases) {
      const { pgDb, insertValues } = makeTrxChain({});
      const repo = new ReorgEventRepository(pgDb as never);
      await repo.writeReorgEventAndOrphan({ ...BASE_INPUT, notes });
      const inserted = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(inserted['notes']).toBe(notes);
    }
  });
});
