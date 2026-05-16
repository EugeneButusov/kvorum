import { describe, expect, it, vi } from 'vitest';
import { CompoundArchiveRepository } from './compound-archive-repository';
import type { CompoundArchivePayloadRow } from './compound-archive-repository';

const ROWS: CompoundArchivePayloadRow[] = [
  {
    chain_id: '0x1',
    tx_hash: '0xtx1',
    log_index: 0,
    block_hash: '0xblock1',
    event_type: 'ProposalCreated',
    payload: JSON.stringify({ proposalId: '42' }),
    received_at: new Date('2026-01-01T00:00:00Z'),
  },
  {
    chain_id: '0x1',
    tx_hash: '0xtx2',
    log_index: 1,
    block_hash: '0xblock2',
    event_type: 'ProposalQueued',
    payload: JSON.stringify({ proposalId: '42' }),
    received_at: new Date('2026-01-01T00:05:00Z'),
  },
];

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    execute,
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('CompoundArchiveRepository', () => {
  it('findByProposalId queries the compound archive by dao source and proposal id', async () => {
    const { selectFrom, chain } = makeSelectChain(ROWS);
    const repo = new CompoundArchiveRepository({ selectFrom } as never);

    await expect(repo.findByProposalId('source-1', '42')).resolves.toEqual(ROWS);
    expect(selectFrom).toHaveBeenCalledWith('event_archive_compound_governor');
    expect(chain.select).toHaveBeenCalledWith([
      'chain_id',
      'tx_hash',
      'log_index',
      'block_hash',
      'event_type',
      'payload',
      'received_at',
    ]);
    expect(chain.where).toHaveBeenCalledTimes(2);
    expect(chain.orderBy).toHaveBeenCalledWith('received_at', 'asc');
  });

  it('fetchPayloads returns rows in the same order query would produce', async () => {
    const { selectFrom, chain } = makeSelectChain(ROWS);
    const repo = new CompoundArchiveRepository({ selectFrom } as never);

    await expect(
      repo.fetchPayloads([
        {
          id: 'row-1',
          source_type: 'compound_governor',
          dao_source_id: 'source-1',
          chain_id: '0x1',
          block_number: '100',
          block_hash: '0xblock1',
          tx_hash: '0xtx1',
          log_index: 0,
          event_type: 'ProposalCreated',
          confirmed_at: new Date('2026-01-01T00:00:00Z'),
          derivation_attempt_count: 0,
        },
      ]),
    ).resolves.toEqual(ROWS);

    expect(selectFrom).toHaveBeenCalledWith('event_archive_compound_governor');
    expect(chain.select).toHaveBeenCalledWith([
      'chain_id',
      'tx_hash',
      'log_index',
      'block_hash',
      'event_type',
      'payload',
      'received_at',
    ]);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it('fetchPayloads skips the database for empty input', async () => {
    const selectFrom = vi.fn();
    const repo = new CompoundArchiveRepository({ selectFrom } as never);

    await expect(repo.fetchPayloads([])).resolves.toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });
});
