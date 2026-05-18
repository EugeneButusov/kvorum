import type { Logger } from '@libs/chain';
import type { ConfirmationRepository, DlqRepository } from '@libs/db';
import type { EventRepository } from '../persistence/event-repository';

export interface ArchiveWriterDeps {
  eventRepo: EventRepository;
  confirmationRepo: ConfirmationRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  /** Wall-clock factory for PG `received_at` and DLQ timestamps. Injectable for tests. */
  now?: () => Date;
}

export interface ArchiveWriteContext {
  daoSourceId: string;
  sourceType: string;
  chainId: string;
  sourceLabel: string;
  /** Per-event confirmation classifier. Absent on the live path (defaults to 'pending'). */
  confirmationClassifier?: (blockNumber: bigint) => 'pending' | 'confirmed';
}

export type ArchiveWriteOutcome = {
  result: 'inserted' | 'skipped_existing' | 'skipped_conflict' | 'dlq_routed' | 'unreachable';
};
