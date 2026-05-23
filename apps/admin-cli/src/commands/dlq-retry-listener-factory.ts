import type { EventsListener } from '@libs/chain';
import { chDb, ConfirmationRepository, DlqRepository, pgDb } from '@libs/db';
import { isCompTokenArchiveStage } from './dlq-retry-stage.js';

export interface DlqRetryListenerFactoryInput {
  stage: string;
  archiveSourceType: string;
  archiveChainId: string;
  daoSourceId: string;
}

interface DlqRetryListenerPlugin {
  supports(input: DlqRetryListenerFactoryInput): boolean;
  make(input: DlqRetryListenerFactoryInput): Promise<EventsListener>;
}

export async function makeDlqRetryListener(
  input: DlqRetryListenerFactoryInput,
): Promise<EventsListener> {
  for (const plugin of DLQ_RETRY_LISTENER_PLUGINS) {
    if (plugin.supports(input)) return plugin.make(input);
  }
  throw new Error(
    `no dlq retry listener plugin for stage=${input.stage} source_type=${input.archiveSourceType}`,
  );
}

const DLQ_RETRY_LISTENER_PLUGINS: readonly DlqRetryListenerPlugin[] = [
  {
    supports: (input) => isCompTokenArchiveStage(input.stage),
    make: async (input) => {
      const { CompTokenArchiveWriter, CompTokenEventRepository, makeCompTokenIngesterListener } =
        await import('@sources/compound');

      const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
      const context = {
        daoSourceId: input.daoSourceId,
        sourceType: input.archiveSourceType,
        chainId: input.archiveChainId,
        sourceLabel: input.archiveSourceType,
      };
      const dlqRepo = new DlqRepository(pgDb);

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
    },
  },
  {
    supports: () => true,
    make: async (input) => {
      const { GovernorArchiveWriter, GovernorEventRepository, makeIngesterListener } = await import(
        '@sources/compound'
      );

      const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
      const context = {
        daoSourceId: input.daoSourceId,
        sourceType: input.archiveSourceType,
        chainId: input.archiveChainId,
        sourceLabel: input.archiveSourceType,
      };
      const dlqRepo = new DlqRepository(pgDb);

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
    },
  },
];
