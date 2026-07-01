import { describe, expect, it } from 'vitest';
import type { OffchainArchiveRow } from '@libs/db';
import { ForumThreadActorAddressDeriver } from './actor-address-deriver';

function row(id: string, externalId: string): OffchainArchiveRow {
  return {
    id,
    source_type: 'discourse_forum',
    dao_source_id: 'dao-source-1',
    chain_id: 'off-chain',
    external_id: externalId,
    derivation_ordinal: '42',
    event_type: 'DiscourseTopicCrawled',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
  };
}

describe('ForumThreadActorAddressDeriver', () => {
  const deriver = new ForumThreadActorAddressDeriver();

  it('is registered for the discourse_forum crawled-topic event', () => {
    expect(deriver.kind).toBe('offchain-actor-address');
    expect(deriver.sourceTypes).toEqual(['discourse_forum']);
    expect(deriver.eventTypes).toEqual(['DiscourseTopicCrawled']);
  });

  it('returns one keyed payload per row without a CH round-trip', async () => {
    const rows = [row('1', 'topic:10'), row('2', 'topic:11')];
    const payloads = await deriver.fetchPayloads(rows);
    expect(payloads).toEqual([
      { external_id: 'topic:10', event_type: 'DiscourseTopicCrawled', payload: '' },
      { external_id: 'topic:11', event_type: 'DiscourseTopicCrawled', payload: '' },
    ]);
  });

  it('extracts zero addresses (forum posts have no on-chain actors)', () => {
    expect(deriver.extractAddresses()).toEqual([]);
  });
});
