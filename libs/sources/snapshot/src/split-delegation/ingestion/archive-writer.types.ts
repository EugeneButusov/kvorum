import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { SplitDelegationEventRepository } from '../persistence/event-repository';

export interface SplitDelegationArchiveWriterDeps {
  eventRepo: SplitDelegationEventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}
