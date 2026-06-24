import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { ArchiveWriteContext, ArchiveWriteOutcome } from '@sources/core';
import type { DualGovernanceEventRepository } from '../persistence/event-repository';

export interface LidoDualGovernanceArchiveWriterDeps {
  eventRepo: DualGovernanceEventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}

export type { ArchiveWriteContext, ArchiveWriteOutcome };
