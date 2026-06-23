import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AragonVotingArchivePayloadRepository } from './archive-payload-repository';

function makeRow(): ArchiveDerivationRow {
  return {
    id: 'a1',
    source_type: 'aragon_voting',
    dao_source_id: 's1',
    chain_id: '0x1',
    block_number: '100',
    block_hash: '0xblock',
    tx_hash: '0xtx',
    log_index: 1,
    event_type: 'StartVote',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
  } as ArchiveDerivationRow;
}

function makeChain<T>(result: T) {
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    execute: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

describe('AragonVotingArchivePayloadRepository', () => {
  it('returns [] for an empty batch without querying', async () => {
    const ch = { selectFrom: vi.fn() };
    const repo = new AragonVotingArchivePayloadRepository(ch as never);
    expect(await repo.fetchPayloads([])).toEqual([]);
    expect(ch.selectFrom).not.toHaveBeenCalled();
  });

  it('fetches payloads from the CH archive table ordered by received_at', async () => {
    const rows = [
      {
        chain_id: '0x1',
        tx_hash: '0xtx',
        log_index: 1,
        block_hash: '0xblock',
        event_type: 'StartVote',
        payload: '{}',
        received_at: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const chain = makeChain(rows);
    const ch = { selectFrom: vi.fn().mockReturnValue(chain) };
    const repo = new AragonVotingArchivePayloadRepository(ch as never);

    const result = await repo.fetchPayloads([makeRow()]);
    expect(result).toEqual(rows);
    expect(ch.selectFrom).toHaveBeenCalledWith('archive_event_aragon_voting');
    expect(chain.orderBy).toHaveBeenCalledWith('received_at', 'asc');
  });
});
