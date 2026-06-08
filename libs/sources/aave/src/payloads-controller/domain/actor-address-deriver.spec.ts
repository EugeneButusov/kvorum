import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AavePayloadsControllerActorAddressDeriver } from './actor-address-deriver';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_payloads_controller',
  dao_source_id: 'source-1',
  chain_id: '0xa',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'PayloadCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('AavePayloadsControllerActorAddressDeriver', () => {
  it('delegates payload lookup to the archive payload repository', async () => {
    const payloads = [{ payload: '{}' }];
    const repo = { fetchPayloads: vi.fn().mockResolvedValue(payloads) };
    const deriver = new AavePayloadsControllerActorAddressDeriver(repo as never);

    await expect(deriver.fetchPayloads([ROW])).resolves.toEqual(payloads);
    expect(repo.fetchPayloads).toHaveBeenCalledWith([ROW]);
  });

  it.each(['PayloadCreated', 'PayloadQueued', 'PayloadExecuted', 'PayloadCancelled'] as const)(
    'returns no actor addresses for %s',
    (eventType) => {
      const deriver = new AavePayloadsControllerActorAddressDeriver({
        fetchPayloads: vi.fn(),
      } as never);

      expect(deriver.extractAddresses(eventType, JSON.stringify({ payloadId: '17' }))).toEqual([]);
    },
  );

  it('registers the expected source and event types', () => {
    const deriver = new AavePayloadsControllerActorAddressDeriver({
      fetchPayloads: vi.fn(),
    } as never);

    expect(deriver.sourceTypes).toEqual(['aave_payloads_controller']);
    expect(deriver.eventTypes).toEqual([
      'PayloadCreated',
      'PayloadQueued',
      'PayloadExecuted',
      'PayloadCancelled',
    ]);
  });
});
