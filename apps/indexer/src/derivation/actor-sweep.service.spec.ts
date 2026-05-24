import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import type { ActorSweepAdapter } from '@sources/core';
import { ActorSweepService } from './actor-sweep.service';

const SOURCE_TYPES = [
  'test_source_alpha',
  'test_source_bravo',
  'test_source_oz',
  'test_source_token',
] as const;

const EVENT_TYPES = ['test_vote_event', 'test_delegation_event'] as const;

function extractAddresses(eventType: string, payloadJson: string) {
  const payload = JSON.parse(payloadJson) as Record<string, string>;

  if (eventType === 'test_vote_event') {
    return [{ address: payload['voter'] ?? '', source: 'voter_event' }];
  }

  if (eventType === 'test_delegation_event') {
    return [
      { address: payload['delegator'] ?? '', source: 'delegator_event' },
      { address: payload['toDelegate'] ?? '', source: 'delegate_event' },
      { address: payload['fromDelegate'] ?? '', source: 'delegate_event' },
    ];
  }

  return [];
}

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'test_source_bravo',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'test_vote_event',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('ActorSweepService', () => {
  it('materializes actor for voter and marks row actor-resolved', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      markActorResolved: vi.fn().mockResolvedValue(undefined),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const actors = {
      findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
    };
    const dlq = { insert: vi.fn() };
    const sourcePayloads = {
      fetchPayloads: vi.fn().mockResolvedValue([
        {
          chain_id: ROW.chain_id,
          tx_hash: ROW.tx_hash,
          log_index: ROW.log_index,
          block_hash: ROW.block_hash,
          event_type: ROW.event_type,
          payload: JSON.stringify({ voter: '0x' + 'ab'.repeat(20) }),
          received_at: new Date(),
        },
      ]),
    };
    const adapter: ActorSweepAdapter = {
      sourceTypes: SOURCE_TYPES,
      eventTypes: EVENT_TYPES,
      extractAddresses,
      fetchPayloads: sourcePayloads.fetchPayloads,
    };
    const service = new ActorSweepService(archive as never, actors as never, dlq as never, [
      adapter,
    ]);

    await service.tick();

    expect(actors.findOrCreateActorAddress).toHaveBeenCalledWith(
      '0x' + 'ab'.repeat(20),
      'voter_event',
    );
    expect(archive.markActorResolved).toHaveBeenCalledWith('archive-1');
    expect(dlq.insert).not.toHaveBeenCalled();
  });

  it('skips zero-address delegate without creating actor', async () => {
    const row = { ...ROW, event_type: 'test_delegation_event', source_type: 'test_source_token' };
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([row]),
      markActorResolved: vi.fn().mockResolvedValue(undefined),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const actors = {
      findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
    };
    const dlq = { insert: vi.fn() };
    const sourceTokenPayloads = {
      fetchPayloads: vi.fn().mockResolvedValue([
        {
          chain_id: ROW.chain_id,
          tx_hash: ROW.tx_hash,
          log_index: ROW.log_index,
          block_hash: ROW.block_hash,
          event_type: row.event_type,
          payload: JSON.stringify({
            delegator: '0x' + 'cd'.repeat(20),
            fromDelegate: `0x${'0'.repeat(40)}`,
            toDelegate: '0x' + 'ef'.repeat(20),
          }),
          received_at: new Date(),
        },
      ]),
    };
    const adapter: ActorSweepAdapter = {
      sourceTypes: SOURCE_TYPES,
      eventTypes: EVENT_TYPES,
      extractAddresses,
      fetchPayloads: sourceTokenPayloads.fetchPayloads,
    };
    const service = new ActorSweepService(archive as never, actors as never, dlq as never, [
      adapter,
    ]);

    await service.tick();

    expect(actors.findOrCreateActorAddress).toHaveBeenCalledTimes(2);
    expect(actors.findOrCreateActorAddress).toHaveBeenCalledWith(
      '0x' + 'cd'.repeat(20),
      'delegator_event',
    );
    expect(actors.findOrCreateActorAddress).toHaveBeenCalledWith(
      '0x' + 'ef'.repeat(20),
      'delegate_event',
    );
  });

  it('increments attempts and writes DLQ row when threshold is reached', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      markActorResolved: vi.fn(),
      incrementActorResolutionAttemptCount: vi.fn().mockResolvedValue(5),
    };
    const actors = {
      findOrCreateActorAddress: vi.fn(),
    };
    const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
    const sourcePayloads = {
      fetchPayloads: vi.fn().mockResolvedValue([
        {
          chain_id: ROW.chain_id,
          tx_hash: ROW.tx_hash,
          log_index: ROW.log_index,
          block_hash: ROW.block_hash,
          event_type: ROW.event_type,
          payload: '{invalid-json',
          received_at: new Date(),
        },
      ]),
    };
    const adapter: ActorSweepAdapter = {
      sourceTypes: SOURCE_TYPES,
      eventTypes: EVENT_TYPES,
      extractAddresses,
      fetchPayloads: sourcePayloads.fetchPayloads,
    };
    const service = new ActorSweepService(archive as never, actors as never, dlq as never, [
      adapter,
    ]);

    await service.tick();

    expect(archive.incrementActorResolutionAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'actor_resolution_stage',
        source: 'indexer.actor_sweep',
        archive_source_type: 'test_source_bravo',
      }),
    );
    expect(archive.markActorResolved).not.toHaveBeenCalled();
  });
});
