import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { AaveTokenEventRepository } from '../persistence/event-repository';

export interface AaveTokenArchiveWriterDeps {
  eventRepo: AaveTokenEventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}
