import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { ArchiveWriteContext, ArchiveWriteOutcome } from '@sources/core';
import type { AaveGovernorV2EventRepository } from '../persistence/event-repository';

export interface AaveGovernorV2ArchiveWriterDeps {
  eventRepo: AaveGovernorV2EventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}

export type { ArchiveWriteContext, ArchiveWriteOutcome };
