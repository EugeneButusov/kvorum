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

function makeCountSelectChain(returnValue: unknown) {
  const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirstOrThrow,
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('ArchiveDerivationRepository', () => {
  it('selects confirmed underived rows in deterministic order', async () => {
    const pgSelect = makeSelectChain([ARCHIVE_ROW]);
    const repo = new ArchiveDerivationRepository({ selectFrom: pgSelect.selectFrom } as never);

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

  it('marks a row derived', async () => {
    const update = makeUpdateChain();
    const repo = new ArchiveDerivationRepository({ updateTable: update.updateTable } as never);

    await repo.markDerived('row-1');

    expect(update.updateTable).toHaveBeenCalledWith('archive_confirmation');
    expect(update.where).toHaveBeenCalledWith('id', '=', 'row-1');
  });

  it('increments derivation attempt count', async () => {
    const update = makeUpdateChain();
    const repo = new ArchiveDerivationRepository({ updateTable: update.updateTable } as never);

    await repo.incrementAttemptCount('row-1');

    expect(update.updateTable).toHaveBeenCalledWith('archive_confirmation');
    expect(update.where).toHaveBeenCalledWith('id', '=', 'row-1');
  });

  it('counts confirmed underived rows without a starting block', async () => {
    const select = makeCountSelectChain({ count: '7' });
    const repo = new ArchiveDerivationRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.countConfirmedUnderived('source-1')).resolves.toBe(7);

    expect(select.selectFrom).toHaveBeenCalledWith('archive_confirmation');
    expect(select.chain.where).toHaveBeenCalledWith('dao_source_id', '=', 'source-1');
    expect(select.chain.where).toHaveBeenCalledWith('confirmation_status', '=', 'confirmed');
    expect(select.chain.where).not.toHaveBeenCalledWith('block_number', '>=', expect.anything());
  });

  it('counts confirmed underived rows from a starting block', async () => {
    const select = makeCountSelectChain({ count: '3' });
    const repo = new ArchiveDerivationRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.countConfirmedUnderived('source-1', 123n)).resolves.toBe(3);

    expect(select.chain.where).toHaveBeenCalledWith('block_number', '>=', '123');
  });
});
