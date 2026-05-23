import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { GovernorVoteProjectionApplier } from './governor-vote-projection-applier';
import type { GovernorArchivePayloadRow } from '../persistence/governor-archive-payload-repository';

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

const PAYLOAD: GovernorArchivePayloadRow = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'VoteCast',
  payload: JSON.stringify({
    voter: `0x${'ab'.repeat(20)}`,
    proposalId: '42',
    primaryChoice: 1,
    votingPowerReported: '123',
    compound: { supportRaw: 1, reason: 'reason' },
  }),
  received_at: new Date('2026-01-01T00:00:00Z'),
};

describe('GovernorVoteProjectionApplier', () => {
  it('exposes VoteCast event type', () => {
    const applier = new GovernorVoteProjectionApplier({
      pgDb: {} as never,
      chDb: {} as never,
      archive: {} as never,
      dlq: {} as never,
      payloads: {} as never,
      registry: {} as never,
      metrics: { batchLookupSeconds: vi.fn(), processed: vi.fn() },
    });
    expect(applier.eventTypes).toEqual(['VoteCast']);
  });

  it('marks row failed when chain context is missing', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
    const payloads = { fetchPayloads: vi.fn().mockResolvedValue([PAYLOAD]) };
    const metrics = { batchLookupSeconds: vi.fn(), processed: vi.fn() };
    const applier = new GovernorVoteProjectionApplier({
      pgDb: {} as never,
      chDb: {} as never,
      archive: archive as never,
      dlq: dlq as never,
      payloads: payloads as never,
      registry: { peek: vi.fn().mockReturnValue(undefined) } as never,
      metrics,
    });

    await applier.applyBatch([ROW]);

    expect(payloads.fetchPayloads).toHaveBeenCalledWith([ROW]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: 'block_timestamp_unavailable',
      }),
    );
  });
});
