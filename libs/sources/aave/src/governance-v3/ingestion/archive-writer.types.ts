import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { ArchiveWriteContext, ArchiveWriteOutcome } from '../../shared';
import type { AaveGovernanceEventRepository } from '../persistence/event-repository';

export interface AaveGovernanceArchiveWriterDeps {
  eventRepo: AaveGovernanceEventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}

export type { ArchiveWriteContext, ArchiveWriteOutcome };
