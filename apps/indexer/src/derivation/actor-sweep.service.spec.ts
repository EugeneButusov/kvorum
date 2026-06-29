import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import type { ActorSweepAdapter } from '@sources/core';
import { ActorSweepService, archiveRowKey } from './actor-sweep.service';

vi.mock('./derivation-metrics', () => ({
  derivationMetrics: {
    lagSeconds: { record: vi.fn() },
    processed: { add: vi.fn() },
    tickDurationSeconds: { record: vi.fn() },
    batchLookupSeconds: { record: vi.fn() },
    chWriteSeconds: { record: vi.fn() },
    timestampFill: { add: vi.fn() },
    timestampFillBacklog: { record: vi.fn() },
  },
}));

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
  it('returns early when no unresolved actors exist', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]),
      markActorResolved: vi.fn(),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const service = new ActorSweepService(archive as never, {} as never, {} as never, []);
    await expect(service.tick()).resolves.toBeUndefined();
    expect(archive.markActorResolved).not.toHaveBeenCalled();
  });

  it('materializes actor for voter and marks row actor-resolved', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]),
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

  it('resolves an off-chain proposer (external_id-keyed) and marks the row resolved', async () => {
    const offchainRow = {
      id: 'oc-1',
      source_type: 'snapshot',
      dao_source_id: 'source-1',
      chain_id: 'off-chain',
      external_id: 'prop:0xabc',
      derivation_ordinal: '100',
      event_type: 'SnapshotProposalCreated',
      received_at: new Date('2026-01-01T00:00:00Z'),
      derivation_attempt_count: 0,
    };
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([offchainRow]),
      markActorResolved: vi.fn().mockResolvedValue(undefined),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const actors = {
      findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
    };
    const dlq = { insert: vi.fn() };
    const offchainAdapter = {
      kind: 'offchain-actor-address' as const,
      sourceTypes: ['snapshot'],
      eventTypes: ['SnapshotProposalCreated'],
      fetchPayloads: vi.fn().mockResolvedValue([
        {
          external_id: 'prop:0xabc',
          event_type: 'SnapshotProposalCreated',
          payload: JSON.stringify({ author: '0x' + 'cd'.repeat(20) }),
        },
      ]),
      extractAddresses: (_eventType: string, payloadJson: string) => {
        const payload = JSON.parse(payloadJson) as Record<string, string>;
        return [{ address: payload['author'] ?? '', role: 'proposer_event' }];
      },
    };
    const service = new ActorSweepService(archive as never, actors as never, dlq as never, [], [
      offchainAdapter,
    ] as never);

    await service.tick();

    expect(offchainAdapter.fetchPayloads).toHaveBeenCalledWith([offchainRow]);
    expect(actors.findOrCreateActorAddress).toHaveBeenCalledWith(
      '0x' + 'cd'.repeat(20),
      'proposer_event',
    );
    expect(archive.markActorResolved).toHaveBeenCalledWith('oc-1');
    expect(dlq.insert).not.toHaveBeenCalled();
  });

  it('skips zero-address delegate without creating actor', async () => {
    const row = { ...ROW, event_type: 'test_delegation_event', source_type: 'test_source_token' };
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([row]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]),
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
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]),
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

  it('groups two rows with same source_type into one processSourceBatch call', async () => {
    const row2 = { ...ROW, id: 'archive-2', tx_hash: '0xtx2', log_index: 2 };
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([ROW, row2]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]),
      markActorResolved: vi.fn().mockResolvedValue(undefined),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const actors = { findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }) };
    const dlq = { insert: vi.fn() };
    const payload = (row: typeof ROW) => ({
      chain_id: row.chain_id,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      block_hash: row.block_hash,
      event_type: row.event_type,
      payload: JSON.stringify({ voter: '0x' + 'ab'.repeat(20) }),
      received_at: new Date(),
    });
    const sourcePayloads = {
      fetchPayloads: vi.fn().mockResolvedValue([payload(ROW), payload(row2)]),
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

    // Both rows are in the same source_type batch → fetchPayloads called once with both rows
    expect(sourcePayloads.fetchPayloads).toHaveBeenCalledTimes(1);
    expect(archive.markActorResolved).toHaveBeenCalledTimes(2);
  });

  it('throws "no adapter" and calls handleFailure when source_type has no registered adapter', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]), // ROW has source_type 'test_source_bravo'
      markActorResolved: vi.fn(),
      incrementActorResolutionAttemptCount: vi.fn().mockResolvedValue(1),
    };
    const actors = { findOrCreateActorAddress: vi.fn() };
    const dlq = { insert: vi.fn() };
    const adapter: ActorSweepAdapter = {
      sourceTypes: ['test_source_alpha'], // does NOT include 'test_source_bravo' → adapter will be undefined
      eventTypes: EVENT_TYPES,
      extractAddresses,
      fetchPayloads: vi.fn().mockResolvedValue([]),
    };
    const service = new ActorSweepService(archive as never, actors as never, dlq as never, [
      adapter,
    ]);

    await service.tick();

    // Inner catch fires for the 'no adapter' throw → handleFailure for each row
    expect(archive.incrementActorResolutionAttemptCount).toHaveBeenCalledWith(ROW.id);
  });

  it('calls handleFailure for all rows when fetchPayloads throws (inner catch)', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]),
      markActorResolved: vi.fn(),
      incrementActorResolutionAttemptCount: vi.fn().mockResolvedValue(1),
    };
    const actors = { findOrCreateActorAddress: vi.fn() };
    const dlq = { insert: vi.fn() };
    const adapter: ActorSweepAdapter = {
      sourceTypes: SOURCE_TYPES,
      eventTypes: EVENT_TYPES,
      extractAddresses,
      fetchPayloads: vi.fn().mockRejectedValue(new Error('db crash')),
    };
    const service = new ActorSweepService(archive as never, actors as never, dlq as never, [
      adapter,
    ]);

    await service.tick();

    // Inner catch in processSourceBatch: handleFailure called for all rows in batch
    expect(archive.incrementActorResolutionAttemptCount).toHaveBeenCalledWith(ROW.id);
  });

  it('logs actor_sweep_tick_failed when findUnresolvedActors throws (outer catch)', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockRejectedValue(new Error('db down')),
      markActorResolved: vi.fn(),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const service = new ActorSweepService(archive as never, {} as never, {} as never, []);

    await expect(service.tick()).resolves.toBeUndefined();
  });

  it('calls handleFailure when row payload is missing from fetched batch', async () => {
    const archive = {
      findUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      findUnresolvedActorsOffchain: vi.fn().mockResolvedValue([]),
      markActorResolved: vi.fn(),
      incrementActorResolutionAttemptCount: vi.fn().mockResolvedValue(1),
    };
    const actors = { findOrCreateActorAddress: vi.fn() };
    const dlq = { insert: vi.fn() };
    const adapter: ActorSweepAdapter = {
      sourceTypes: SOURCE_TYPES,
      eventTypes: EVENT_TYPES,
      extractAddresses,
      fetchPayloads: vi.fn().mockResolvedValue([]), // no payloads → missing for the row
    };
    const service = new ActorSweepService(archive as never, actors as never, dlq as never, [
      adapter,
    ]);

    await service.tick();

    expect(archive.incrementActorResolutionAttemptCount).toHaveBeenCalledWith(ROW.id);
  });
});

describe('archiveRowKey', () => {
  it('keys EVM rows on the block/tx 4-tuple (unchanged from the prior tuple key)', () => {
    expect(
      archiveRowKey({ chain_id: '0x1', tx_hash: '0xtx', log_index: 3, block_hash: '0xblk' }),
    ).toBe('0x1:0xtx:3:0xblk');
  });

  it('keys off-chain rows on external_id, ignoring null coords', () => {
    expect(
      archiveRowKey({
        chain_id: 'off-chain',
        tx_hash: null,
        log_index: null,
        block_hash: null,
        external_id: 'proposal-0xabc',
      }),
    ).toBe('off-chain:ext:proposal-0xabc');
  });

  it('distinguishes two off-chain rows of the same source by external_id', () => {
    const a = archiveRowKey({ chain_id: 'off-chain', external_id: 'p1' });
    const b = archiveRowKey({ chain_id: 'off-chain', external_id: 'p2' });
    expect(a).not.toBe(b);
  });
});
