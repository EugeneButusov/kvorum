import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { DelegateRegistryArchivePayloadRepository } from './archive-payload-repository';

const ROW: ArchiveDerivationRow = {
  id: 'row-1',
  source_type: 'snapshot_delegate_registry',
  dao_source_id: 'src-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'SetDelegate',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

function makeSelectChain(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValue(rows);
  const chain = { select: vi.fn(), where: vi.fn(), orderBy: vi.fn(), execute };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), ...chain };
}

describe('DelegateRegistryArchivePayloadRepository', () => {
  it('skips the lookup for an empty batch', async () => {
    const ch = makeSelectChain([]);
    const repo = new DelegateRegistryArchivePayloadRepository({
      selectFrom: ch.selectFrom,
    } as never);
    await expect(repo.fetchPayloads([])).resolves.toEqual([]);
    expect(ch.selectFrom).not.toHaveBeenCalled();
  });

  it('fetches payloads by archive row tuple', async () => {
    const ch = makeSelectChain([{ payload: '{}' }]);
    const repo = new DelegateRegistryArchivePayloadRepository({
      selectFrom: ch.selectFrom,
    } as never);
    await expect(repo.fetchPayloads([ROW])).resolves.toEqual([{ payload: '{}' }]);
    expect(ch.selectFrom).toHaveBeenCalledOnce();
  });
});
