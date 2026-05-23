import { ArchiveDerivationAdminRepository, pgDb, type IngestionDlq } from '@libs/db';
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
  private readonly archiveDerivationAdminRepo = new ArchiveDerivationAdminRepository(pgDb);

  constructor(readonly stage: string) {}

  async retry(dlqEntry: IngestionDlq): Promise<RetryOutcome> {
    const archiveConfirmationId = archiveConfirmationIdFromPayload(dlqEntry.payload);
    await this.archiveDerivationAdminRepo.resetWatermarkByConfirmationId(archiveConfirmationId);

    return { status: 'resolved', reason: 'projection retry reset archive_confirmation watermark' };
  }
}
