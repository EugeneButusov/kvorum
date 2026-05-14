import { describe, expect, it, vi } from 'vitest';
import { ArchiveDerivationRepository } from './archive-derivation-repository';
import type { ArchiveDerivationRow } from './archive-derivation-repository';

const ARCHIVE_ROW: ArchiveDerivationRow = {
  id: 'row-1',
  source_type: 'compound_governor',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 2,
};

function makeSelectChain(returnValue: unknown[]) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    execute,
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  const selectFrom = vi.fn().mockReturnValue(chain);

  return { selectFrom, ...chain };
}

function makeUpdateChain() {
  const execute = vi.fn().mockResolvedValue(undefined);
  const where = vi.fn().mockReturnValue({ execute });
  const set = vi.fn().mockReturnValue({ where });
  const updateTable = vi.fn().mockReturnValue({ set });

  return { updateTable, set, where, execute };
}

describe('ArchiveDerivationRepository', () => {
  it('selects confirmed underived rows in deterministic order', async () => {
    const pgSelect = makeSelectChain([ARCHIVE_ROW]);
    const repo = new ArchiveDerivationRepository(
      { selectFrom: pgSelect.selectFrom } as never,
      {} as never,
    );

    await expect(repo.findConfirmedUndderived(50)).resolves.toEqual([ARCHIVE_ROW]);

    expect(pgSelect.selectFrom).toHaveBeenCalledWith('archive_confirmation');
    expect(pgSelect.where.mock.calls).toEqual([
      ['confirmation_status', '=', 'confirmed'],
      ['derived_at', 'is', null],
    ]);
    expect(pgSelect.orderBy.mock.calls).toEqual([
      ['chain_id', 'asc'],
      ['block_number', 'asc'],
      ['log_index', 'asc'],
      ['id', 'asc'],
    ]);
    expect(pgSelect.limit).toHaveBeenCalledWith(50);
  });

  it('skips ClickHouse lookup for an empty batch', async () => {
    const chSelect = makeSelectChain([]);
    const repo = new ArchiveDerivationRepository(
      {} as never,
      {
        selectFrom: chSelect.selectFrom,
      } as never,
    );

    await expect(repo.fetchCompoundPayloads([])).resolves.toEqual([]);

    expect(chSelect.selectFrom).not.toHaveBeenCalled();
  });

  it('fetches compound archive payloads with a FINAL table expression', async () => {
    const payload = {
      chain_id: '0x1',
      tx_hash: '0xtx',
      log_index: 1,
      block_hash: '0xblock',
      event_type: 'ProposalCreated',
      payload: '{}',
      received_at: new Date('2026-01-01T00:00:00Z'),
    };
    const chSelect = makeSelectChain([payload]);
    const repo = new ArchiveDerivationRepository(
      {} as never,
      {
        selectFrom: chSelect.selectFrom,
      } as never,
    );

    await expect(repo.fetchCompoundPayloads([ARCHIVE_ROW])).resolves.toEqual([payload]);

    expect(chSelect.selectFrom).toHaveBeenCalledOnce();
    expect(chSelect.where).toHaveBeenCalledOnce();
  });

  it('marks a row derived', async () => {
    const update = makeUpdateChain();
    const repo = new ArchiveDerivationRepository(
      { updateTable: update.updateTable } as never,
      {
        selectFrom: vi.fn(),
      } as never,
    );

    await repo.markDerived('row-1');

    expect(update.updateTable).toHaveBeenCalledWith('archive_confirmation');
    expect(update.where).toHaveBeenCalledWith('id', '=', 'row-1');
  });

  it('increments derivation attempt count', async () => {
    const update = makeUpdateChain();
    const repo = new ArchiveDerivationRepository(
      { updateTable: update.updateTable } as never,
      {
        selectFrom: vi.fn(),
      } as never,
    );

    await repo.incrementAttemptCount('row-1');

    expect(update.updateTable).toHaveBeenCalledWith('archive_confirmation');
    expect(update.where).toHaveBeenCalledWith('id', '=', 'row-1');
  });
});
