import { describe, it, expect, vi } from 'vitest';
import type { OffchainArchiveRow } from '@libs/db';
import { SnapshotActorAddressDeriver } from './actor-address-deriver';

function row(externalId: string, eventType: OffchainArchiveRow['event_type']): OffchainArchiveRow {
  return {
    id: externalId,
    source_type: 'snapshot',
    dao_source_id: 'src-1',
    chain_id: 'off-chain',
    external_id: externalId,
    derivation_ordinal: '1',
    event_type: eventType,
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
  };
}

describe('SnapshotActorAddressDeriver', () => {
  it('claims both proposal-created and vote-cast events', () => {
    const deriver = new SnapshotActorAddressDeriver({} as never);
    expect([...deriver.eventTypes]).toEqual(['SnapshotProposalCreated', 'SnapshotVoteCast']);
  });

  it('fetchPayloads tags each payload with its own row event_type across a mixed batch', async () => {
    const payloads = {
      fetchLatest: vi.fn().mockResolvedValue([
        { external_id: 'prop:0x1', payload: '{"author":"0xa"}' },
        { external_id: 'vote:0x2', payload: '{"voter":"0xb"}' },
      ]),
    };
    const deriver = new SnapshotActorAddressDeriver(payloads as never);
    const rows = [row('prop:0x1', 'SnapshotProposalCreated'), row('vote:0x2', 'SnapshotVoteCast')];

    const result = await deriver.fetchPayloads(rows);

    expect(payloads.fetchLatest).toHaveBeenCalledWith(rows);
    expect(result).toEqual([
      {
        external_id: 'prop:0x1',
        event_type: 'SnapshotProposalCreated',
        payload: '{"author":"0xa"}',
      },
      { external_id: 'vote:0x2', event_type: 'SnapshotVoteCast', payload: '{"voter":"0xb"}' },
    ]);
  });

  it('fetchPayloads throws if a returned payload has no matching archive row (invariant)', async () => {
    const payloads = {
      fetchLatest: vi.fn().mockResolvedValue([{ external_id: 'vote:0xZ', payload: '{}' }]),
    };
    const deriver = new SnapshotActorAddressDeriver(payloads as never);
    await expect(
      deriver.fetchPayloads([row('prop:0x1', 'SnapshotProposalCreated')]),
    ).rejects.toThrow(/no archive row for external_id vote:0xZ/);
  });

  it('extracts the proposer author from a proposal event', () => {
    const deriver = new SnapshotActorAddressDeriver({} as never);
    expect(
      deriver.extractAddresses('SnapshotProposalCreated', JSON.stringify({ author: '0xabc' })),
    ).toEqual([{ address: '0xabc', role: 'proposer_event' }]);
  });

  it('extracts the voter from a vote event', () => {
    const deriver = new SnapshotActorAddressDeriver({} as never);
    expect(
      deriver.extractAddresses('SnapshotVoteCast', JSON.stringify({ voter: '0xdef' })),
    ).toEqual([{ address: '0xdef', role: 'voter_event' }]);
  });

  it('returns nothing for a missing/empty proposer or voter', () => {
    const deriver = new SnapshotActorAddressDeriver({} as never);
    expect(
      deriver.extractAddresses('SnapshotProposalCreated', JSON.stringify({ author: null })),
    ).toEqual([]);
    expect(
      deriver.extractAddresses('SnapshotProposalCreated', JSON.stringify({ author: '' })),
    ).toEqual([]);
    expect(deriver.extractAddresses('SnapshotVoteCast', '{}')).toEqual([]);
    expect(deriver.extractAddresses('SnapshotVoteCast', JSON.stringify({ voter: '' }))).toEqual([]);
  });

  it('returns nothing for an unrelated event type', () => {
    const deriver = new SnapshotActorAddressDeriver({} as never);
    expect(deriver.extractAddresses('StartVote', JSON.stringify({ author: '0xabc' }))).toEqual([]);
  });
});
