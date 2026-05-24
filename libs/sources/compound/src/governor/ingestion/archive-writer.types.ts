import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { GovernorEventRepository } from '../persistence/event-repository';

export interface GovernorArchiveWriterDeps {
  eventRepo: GovernorEventRepository;
  archiveEventRepo: ArchiveEventRepository;
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
}

export type ArchiveWriteOutcome = {
  result: 'inserted' | 'skipped_existing' | 'skipped_conflict' | 'dlq_routed' | 'unreachable';
};
