import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AragonVotingProjectionApplier } from './aragon-voting-projection-applier';
import type { AragonVotingArchivePayloadRow } from '../persistence/archive-payload-repository';

function makeRow(overrides: Partial<ArchiveDerivationRow>): ArchiveDerivationRow {
  return {
    id: 'archive-1',
    source_type: 'aragon_voting',
    dao_source_id: 'source-1',
    chain_id: '0x1',
    block_number: '100',
    block_hash: '0xblock',
    tx_hash: '0xtx',
    log_index: 1,
    event_type: 'ChangeVoteTime',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  } as ArchiveDerivationRow;
}

function makePayload(
  overrides: Partial<AragonVotingArchivePayloadRow>,
): AragonVotingArchivePayloadRow {
  return {
    chain_id: '0x1',
    tx_hash: '0xtx',
    log_index: 1,
    block_hash: '0xblock',
    event_type: 'ChangeVoteTime',
    payload: JSON.stringify({ voteTime: '259200' }),
    received_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMetrics() {
  return { batchLookupSeconds: vi.fn(), processed: vi.fn() };
}

// Minimal tx mock supporting the archive_event watermark updates the drain path makes.
function makeTxPgDb() {
  const archiveWrites: Array<'derived' | 'actor_resolved'> = [];
  const tx = {
    updateTable: vi.fn(() => {
      let kind: 'derived' | 'actor_resolved' | undefined;
      const chain = {
        set: vi.fn((values: Record<string, unknown>) => {
          if ('derived_at' in values) kind = 'derived';
          if ('derivation_actor_resolved_at' in values) kind = 'actor_resolved';
          return chain;
        }),
        where: vi.fn(() => chain),
        execute: vi.fn(async () => {
          if (kind) archiveWrites.push(kind);
          return undefined;
        }),
      };
      return chain;
    }),
  };
  const pgDb = {
    transaction: vi.fn(() => ({
      execute: vi.fn((fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
    })),
  };
  return { pgDb, archiveWrites };
}

describe('AragonVotingProjectionApplier', () => {
  it('declares the proposal-lifecycle + config contract', () => {
    const applier = new AragonVotingProjectionApplier({} as never);
    expect(applier.kind).toBe('projection');
    expect([...applier.sourceTypes]).toEqual(['aragon_voting']);
    expect([...applier.eventTypes]).toEqual([
      'StartVote',
      'ExecuteVote',
      'ChangeSupportRequired',
      'ChangeMinQuorum',
      'ChangeVoteTime',
      'ChangeObjectionPhaseTime',
    ]);
  });

  it('drains a Change* config event as a no-op (marks derived + actor-resolved, no proposal)', async () => {
    const { pgDb, archiveWrites } = makeTxPgDb();
    const payloads = { fetchPayloads: vi.fn().mockResolvedValue([makePayload({})]) };
    const metrics = makeMetrics();

    const applier = new AragonVotingProjectionApplier({
      pgDb: pgDb as never,
      archive: {} as never,
      dlq: {} as never,
      payloads: payloads as never,
      metrics,
    });

    await applier.applyBatch([makeRow({})]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'ChangeVoteTime', outcome: 'skipped_config' }),
    );
    // both watermarks stamped so the config row drains (zero-underived gate)
    expect(archiveWrites).toEqual(['derived', 'actor_resolved']);
  });
});
