import { chDb, ConfirmationRepository, DlqRepository, pgDb } from '@libs/db';
import type { EventsListener } from '@libs/chain';
import { isCompTokenArchiveStage } from './dlq-retry-stage.js';

export interface DlqRetryListenerFactoryInput {
  stage: string;
  archiveSourceType: string;
  archiveChainId: string;
  daoSourceId: string;
}

export async function makeDlqRetryListener(
  input: DlqRetryListenerFactoryInput,
): Promise<EventsListener> {
  const {
    ArchiveWriter: GovernorArchiveWriter,
    CompTokenArchiveWriter,
    CompTokenEventRepository,
    EventRepository: GovernorEventRepository,
    makeCompTokenIngesterListener,
    makeIngesterListener,
  } = await import('@sources/compound');

  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const context = {
    daoSourceId: input.daoSourceId,
    sourceType: input.archiveSourceType,
    chainId: input.archiveChainId,
    sourceLabel: input.archiveSourceType,
  };
  const dlqRepo = new DlqRepository(pgDb);

  if (isCompTokenArchiveStage(input.stage)) {
    return makeCompTokenIngesterListener(
      {
        archiveWriter: new CompTokenArchiveWriter({
          eventRepo: new CompTokenEventRepository({ chDb }),
          confirmationRepo: new ConfirmationRepository(pgDb),
          dlqRepo,
          logger,
        }),
        context,
        logger,
        dlqRepo,
      },
      { onWriteFailure: 'throw' },
    );
  }

  return makeIngesterListener(
    {
      archiveWriter: new GovernorArchiveWriter({
        eventRepo: new GovernorEventRepository({ chDb }),
        confirmationRepo: new ConfirmationRepository(pgDb),
        dlqRepo,
        logger,
      }),
      context,
      logger,
      dlqRepo,
    },
    { onWriteFailure: 'throw' },
  );
}
