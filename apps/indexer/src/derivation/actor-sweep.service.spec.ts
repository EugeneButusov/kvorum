import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { COMPOUND_ACTOR_SWEEP_EXTRACTOR } from './actor-sweep-extractor';
import { ActorSweepService } from './actor-sweep.service';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'compound_governor_bravo',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'VoteCast',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('ActorSweepService', () => {
  it('materializes actor for voter and marks row actor-resolved', async () => {
    const archive = {
      findConfirmedUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      markActorResolved: vi.fn().mockResolvedValue(undefined),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const actors = {
      findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
    };
    const dlq = { insert: vi.fn() };
    const governorPayloads = {
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
    const compTokenPayloads = { fetchPayloads: vi.fn() };
    const service = new ActorSweepService(
      archive as never,
      actors as never,
      dlq as never,
      governorPayloads as never,
      compTokenPayloads as never,
      [COMPOUND_ACTOR_SWEEP_EXTRACTOR],
    );

    await service.tick();

    expect(actors.findOrCreateActorAddress).toHaveBeenCalledWith(
      '0x' + 'ab'.repeat(20),
      'voter_event',
    );
    expect(archive.markActorResolved).toHaveBeenCalledWith('archive-1');
    expect(dlq.insert).not.toHaveBeenCalled();
  });

  it('skips zero-address delegate without creating actor', async () => {
    const row = { ...ROW, event_type: 'DelegateChanged', source_type: 'compound_comp_token' };
    const archive = {
      findConfirmedUnresolvedActors: vi.fn().mockResolvedValue([row]),
      markActorResolved: vi.fn().mockResolvedValue(undefined),
      incrementActorResolutionAttemptCount: vi.fn(),
    };
    const actors = {
      findOrCreateActorAddress: vi.fn().mockResolvedValue({ id: 'actor-1' }),
    };
    const dlq = { insert: vi.fn() };
    const governorPayloads = { fetchPayloads: vi.fn() };
    const compTokenPayloads = {
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
    const service = new ActorSweepService(
      archive as never,
      actors as never,
      dlq as never,
      governorPayloads as never,
      compTokenPayloads as never,
      [COMPOUND_ACTOR_SWEEP_EXTRACTOR],
    );

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
      findConfirmedUnresolvedActors: vi.fn().mockResolvedValue([ROW]),
      markActorResolved: vi.fn(),
      incrementActorResolutionAttemptCount: vi.fn().mockResolvedValue(5),
    };
    const actors = {
      findOrCreateActorAddress: vi.fn(),
    };
    const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
    const governorPayloads = {
      fetchPayloads: vi.fn().mockResolvedValue([
        {
          chain_id: ROW.chain_id,
          tx_hash: ROW.tx_hash,
          log_index: ROW.log_index,
          block_hash: ROW.block_hash,
          event_type: ROW.event_type,
          payload: JSON.stringify({ voter: 'not-an-address' }),
          received_at: new Date(),
        },
      ]),
    };
    const compTokenPayloads = { fetchPayloads: vi.fn() };
    const service = new ActorSweepService(
      archive as never,
      actors as never,
      dlq as never,
      governorPayloads as never,
      compTokenPayloads as never,
      [COMPOUND_ACTOR_SWEEP_EXTRACTOR],
    );

    await service.tick();

    expect(archive.incrementActorResolutionAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'actor_resolution_stage',
        source: 'indexer.actor_sweep',
        archive_source_type: 'compound_governor_bravo',
      }),
    );
    expect(archive.markActorResolved).not.toHaveBeenCalled();
  });
});
