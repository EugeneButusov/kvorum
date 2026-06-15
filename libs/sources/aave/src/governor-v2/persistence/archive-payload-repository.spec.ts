import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AaveGovernorV2ArchivePayloadRepository } from './archive-payload-repository';

const ARCHIVE_ROW: ArchiveDerivationRow = {
  id: 'row-1',
  source_type: 'aave_governor_v2',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '12010000',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 3,
  event_type: 'ProposalCreated',
  confirmed_at: new Date('2021-01-01T00:00:00Z'),
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

describe('AaveGovernorV2ArchivePayloadRepository', () => {
  it('skips ClickHouse lookup for an empty batch', async () => {
    const chSelect = makeSelectChain([]);
    const repo = new AaveGovernorV2ArchivePayloadRepository({
      selectFrom: chSelect.selectFrom,
    } as never);

    await expect(repo.fetchPayloads([])).resolves.toEqual([]);

    expect(chSelect.selectFrom).not.toHaveBeenCalled();
  });

  it('fetches archived governor-v2 payloads by archive row tuple', async () => {
    const payload = {
      chain_id: '0x1',
      tx_hash: '0xtx',
      log_index: 3,
      block_hash: '0xblock',
      event_type: 'ProposalCreated',
      payload: '{"id":"7"}',
      received_at: new Date('2021-01-01T00:00:00Z'),
    };
    const chSelect = makeSelectChain([payload]);
    const repo = new AaveGovernorV2ArchivePayloadRepository({
      selectFrom: chSelect.selectFrom,
    } as never);

    await expect(repo.fetchPayloads([ARCHIVE_ROW])).resolves.toEqual([payload]);

    expect(chSelect.selectFrom).toHaveBeenCalledWith('archive_event_aave_governor_v2');
    expect(chSelect.where).toHaveBeenCalledOnce();
    expect(chSelect.orderBy).toHaveBeenCalledWith('received_at', 'asc');
  });

  it('passes all rows in a multi-row batch to ClickHouse', async () => {
    const secondRow: ArchiveDerivationRow = {
      ...ARCHIVE_ROW,
      id: 'row-2',
      tx_hash: '0xtx2',
      log_index: 5,
    };
    const chSelect = makeSelectChain([]);
    const repo = new AaveGovernorV2ArchivePayloadRepository({
      selectFrom: chSelect.selectFrom,
    } as never);

    await repo.fetchPayloads([ARCHIVE_ROW, secondRow]);

    expect(chSelect.selectFrom).toHaveBeenCalledOnce();
    expect(chSelect.where).toHaveBeenCalledOnce();
  });
});
