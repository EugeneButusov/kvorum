import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AavePayloadsControllerArchivePayloadRepository } from './archive-payload-repository';

const ARCHIVE_ROW: ArchiveDerivationRow = {
  id: 'row-1',
  source_type: 'aave_payloads_controller',
  dao_source_id: 'source-1',
  chain_id: '0xa',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'PayloadCreated',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
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

describe('AavePayloadsControllerArchivePayloadRepository', () => {
  it('skips ClickHouse lookup for an empty batch', async () => {
    const chSelect = makeSelectChain([]);
    const repo = new AavePayloadsControllerArchivePayloadRepository({
      selectFrom: chSelect.selectFrom,
    } as never);

    await expect(repo.fetchPayloads([])).resolves.toEqual([]);

    expect(chSelect.selectFrom).not.toHaveBeenCalled();
  });

  it('fetches archived payload-controller payloads by archive row tuple', async () => {
    const payload = {
      chain_id: '0xa',
      tx_hash: '0xtx',
      log_index: 1,
      block_hash: '0xblock',
      event_type: 'PayloadCreated',
      payload: '{}',
      received_at: new Date('2026-01-01T00:00:00Z'),
    };
    const chSelect = makeSelectChain([payload]);
    const repo = new AavePayloadsControllerArchivePayloadRepository({
      selectFrom: chSelect.selectFrom,
    } as never);

    await expect(repo.fetchPayloads([ARCHIVE_ROW])).resolves.toEqual([payload]);

    expect(chSelect.selectFrom).toHaveBeenCalledWith('archive_event_aave_payloads_controller');
    expect(chSelect.where).toHaveBeenCalledOnce();
    expect(chSelect.orderBy).toHaveBeenCalledWith('received_at', 'asc');
  });
});
