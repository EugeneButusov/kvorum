import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { CompTokenEventRepository } from '../persistence/event-repository';

export interface CompTokenArchiveWriterDeps {
  eventRepo: CompTokenEventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}
