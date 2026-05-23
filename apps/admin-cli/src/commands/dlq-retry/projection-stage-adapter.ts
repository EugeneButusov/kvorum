import { pgDb, type IngestionDlq } from '@libs/db';
import type { DlqRetryAdapter, RetryOutcome } from './dlq-retry-adapter.js';

function archiveConfirmationIdFromPayload(payload: unknown): string {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('projection DLQ payload is not an object');
  }
  const rec = payload as Record<string, unknown>;
  const id = rec['archive_confirmation_id'] ?? rec['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('projection DLQ payload is missing archive_confirmation_id');
  }
  return id;
}

export class ProjectionStageAdapter implements DlqRetryAdapter {
  constructor(readonly stage: string) {}

  async retry(row: IngestionDlq): Promise<RetryOutcome> {
    const archiveConfirmationId = archiveConfirmationIdFromPayload(row.payload);

    await pgDb
      .updateTable('archive_confirmation')
      .set({ derivation_attempt_count: 0, derived_at: null })
      .where('id', '=', archiveConfirmationId)
      .executeTakeFirst();

    return { status: 'resolved', reason: 'projection retry reset archive_confirmation watermark' };
  }
}
