import { describe, it, expect, vi } from 'vitest';
import type { OffchainArchiveRow } from '@libs/db';
import { SnapshotActorAddressDeriver } from './actor-address-deriver';

const ROW: OffchainArchiveRow = {
  id: 'r1',
  source_type: 'snapshot',
  dao_source_id: 'src-1',
  chain_id: 'off-chain',
  external_id: 'prop:0x1',
  derivation_ordinal: '1',
  event_type: 'SnapshotProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('SnapshotActorAddressDeriver', () => {
  it('fetchPayloads returns latest payloads tagged with the row event_type', async () => {
    const payloads = {
      fetchLatest: vi.fn().mockResolvedValue([{ external_id: 'prop:0x1', payload: '{}' }]),
    };
    const deriver = new SnapshotActorAddressDeriver(payloads as never);

    const result = await deriver.fetchPayloads([ROW]);

    expect(payloads.fetchLatest).toHaveBeenCalledWith([ROW]);
    expect(result).toEqual([
      { external_id: 'prop:0x1', event_type: 'SnapshotProposalCreated', payload: '{}' },
    ]);
  });

  it('extracts the proposer author', () => {
    const deriver = new SnapshotActorAddressDeriver({} as never);
    expect(
      deriver.extractAddresses('SnapshotProposalCreated', JSON.stringify({ author: '0xabc' })),
    ).toEqual([{ address: '0xabc', role: 'proposer_event' }]);
  });

  it('returns nothing for a non-proposal event or missing/empty author', () => {
    const deriver = new SnapshotActorAddressDeriver({} as never);
    expect(deriver.extractAddresses('SnapshotVoteCast', '{}')).toEqual([]);
    expect(
      deriver.extractAddresses('SnapshotProposalCreated', JSON.stringify({ author: null })),
    ).toEqual([]);
    expect(
      deriver.extractAddresses('SnapshotProposalCreated', JSON.stringify({ author: '' })),
    ).toEqual([]);
  });
});
