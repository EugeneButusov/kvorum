import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { ArchiveFailureRouter, archiveEventTupleKey } from './archive-failure-router';

function makeRow(overrides: Partial<ArchiveDerivationRow> = {}): ArchiveDerivationRow {
  return {
    id: 'archive-1',
    source_type: 'aragon_voting',
    dao_source_id: 'source-1',
    chain_id: '0x1',
    block_number: '100',
    block_hash: '0xblock',
    tx_hash: '0xtx',
    log_index: 1,
    event_type: 'CastVote',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  } as ArchiveDerivationRow;
}

function build(threshold = 5) {
  const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const router = new ArchiveFailureRouter({
    archive,
    dlq,
    stage: 'vote_projection_stage',
    source: 'indexer.vote_projection',
    logEvent: 'derivation_failed',
    threshold,
    logger,
  });
  return { router, archive, dlq, logger };
}

describe('archiveEventTupleKey', () => {
  it('builds the EVM 4-tuple correlation key', () => {
    expect(
      archiveEventTupleKey({ chain_id: '0x1', tx_hash: '0xtx', log_index: 2, block_hash: '0xb' }),
    ).toBe('0x1:0xtx:2:0xb');
  });
});

describe('ArchiveFailureRouter', () => {
  it('increments the attempt counter and logs, without DLQ below threshold', async () => {
    const { router, archive, dlq, logger } = build(5);
    await router.route(makeRow({ derivation_attempt_count: 0 }), 'no_proposal', new Error('boom'));

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(logger.error).toHaveBeenCalledWith(
      'derivation_failed',
      expect.objectContaining({ attempt: 1, reason: 'no_proposal', error: 'Error: boom' }),
    );
    expect(dlq.insert).not.toHaveBeenCalled();
  });

  it('routes to the DLQ once the attempt reaches the threshold', async () => {
    const { router, dlq } = build(5);
    // attempt count 4 → this attempt is 5 → at threshold
    await router.route(makeRow({ derivation_attempt_count: 4 }), 'decode_error', new Error('x'));

    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'vote_projection_stage',
        source: 'indexer.vote_projection',
        retries: 5,
        archive_tx_hash: '0xtx',
        archive_block_hash: '0xblock',
        archive_log_index: 1,
      }),
    );
  });
});
