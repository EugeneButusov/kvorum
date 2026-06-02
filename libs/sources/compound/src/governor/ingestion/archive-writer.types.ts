import type { Logger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { GovernorEventRepository } from '../persistence/event-repository';

export interface GovernorArchiveWriterDeps {
  eventRepo: GovernorEventRepository;
  archiveEventRepo: ArchiveEventRepository;
  dlqRepo: DlqRepository;
  logger: Logger;
  now?: () => Date;
}
