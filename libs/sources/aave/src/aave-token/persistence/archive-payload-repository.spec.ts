import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AaveTokenArchivePayloadRepository } from './archive-payload-repository';

const ARCHIVE_ROW: ArchiveDerivationRow = {
  id: 'row-1',
  source_type: 'aave_token',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'DelegateChanged',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 2,
};

function makeSelectChain(returnValue: unknown[]) {
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
  const selectFrom = vi.fn().mockReturnValue(chain);

  return { selectFrom, ...chain };
}

describe('AaveTokenArchivePayloadRepository', () => {
  it('skips the ClickHouse lookup for an empty batch', async () => {
    const chSelect = makeSelectChain([]);
    const repo = new AaveTokenArchivePayloadRepository({
      selectFrom: chSelect.selectFrom,
    } as never);

    await expect(repo.fetchPayloads([])).resolves.toEqual([]);
    expect(chSelect.selectFrom).not.toHaveBeenCalled();
  });

  it('fetches aave_token archive payloads by archive row tuple', async () => {
    const payload = {
      chain_id: '0x1',
      tx_hash: '0xtx',
      log_index: 1,
      block_hash: '0xblock',
      event_type: 'DelegateChanged',
      payload: '{}',
      received_at: new Date('2026-01-01T00:00:00Z'),
    };
    const chSelect = makeSelectChain([payload]);
    const repo = new AaveTokenArchivePayloadRepository({
      selectFrom: chSelect.selectFrom,
    } as never);

    await expect(repo.fetchPayloads([ARCHIVE_ROW])).resolves.toEqual([payload]);
    expect(chSelect.selectFrom).toHaveBeenCalledOnce();
    expect(chSelect.where).toHaveBeenCalledOnce();
  });
});
