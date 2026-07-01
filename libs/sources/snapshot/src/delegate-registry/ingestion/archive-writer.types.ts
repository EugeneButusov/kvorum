import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { DelegateRegistryEventRepository } from '../persistence/event-repository';

export interface DelegateRegistryArchiveWriterDeps {
  eventRepo: DelegateRegistryEventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}
