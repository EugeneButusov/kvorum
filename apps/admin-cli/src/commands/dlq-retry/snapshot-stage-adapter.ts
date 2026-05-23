import { pgDb, type IngestionDlq } from '@libs/db';
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

  async retry(row: IngestionDlq): Promise<RetryOutcome> {
    const proposalId = proposalIdFromPayload(row.payload);

    await pgDb
      .updateTable('voting_power_snapshot_run')
      .set({
        snapshot_attempt_count: 0,
        status: 'in_progress',
        last_error: null,
      })
      .where('proposal_id', '=', proposalId)
      .executeTakeFirst();

    return { status: 'resolved', reason: 'snapshot retry reset run state' };
  }
}
