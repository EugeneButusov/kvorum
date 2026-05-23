import { chDb, ConfirmationRepository, DlqRepository, pgDb } from '@libs/db';
import type {
  DlqRetryListenerFactoryInput,
  DlqRetryListenerProvider,
} from '../commands/dlq-retry-listener-factory.js';
import { isCompTokenArchiveStage } from '../commands/dlq-retry-stage.js';

export function buildDlqRetryListenerProviders(): readonly DlqRetryListenerProvider[] {
  return [buildCompoundCompTokenProvider(), buildCompoundGovernorProvider()];
}

function buildCompoundCompTokenProvider(): DlqRetryListenerProvider {
  return {
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
  };
}

function buildCompoundGovernorProvider(): DlqRetryListenerProvider {
  return {
    supports: (_input: DlqRetryListenerFactoryInput) => true,
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
  };
}
