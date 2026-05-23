import { pgDb, type IngestionDlq, VotingPowerSnapshotRunRepository } from '@libs/db';
import type { DlqRetryAdapter, RetryOutcome } from './dlq-retry-adapter.js';

function proposalIdFromPayload(payload: unknown): string {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('snapshot DLQ payload is not an object');
  }
  const rec = payload as Record<string, unknown>;
  const id = rec['proposal_id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('snapshot DLQ payload is missing proposal_id');
  }
  return id;
}

export class SnapshotStageAdapter implements DlqRetryAdapter {
  readonly stage = 'snapshot_compute_stage';
  private readonly snapshotRuns = new VotingPowerSnapshotRunRepository(pgDb);

  async retry(dlqEntry: IngestionDlq): Promise<RetryOutcome> {
    const proposalId = proposalIdFromPayload(dlqEntry.payload);
    await this.snapshotRuns.resetAttemptForRetry(proposalId);

    return { status: 'resolved', reason: 'snapshot retry reset run state' };
  }
}
