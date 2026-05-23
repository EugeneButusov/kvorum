import type { Logger } from '@libs/chain';
import type { SourceIngester } from '@sources/core';
import type { SourceType } from '@libs/db';
import type {
  DlqRetryListenerFactoryInput,
  DlqRetryListenerProvider,
} from '../commands/dlq-retry-listener-factory.js';
import { buildDefaultBackfillSourcePlugins } from './backfill-source-plugins.js';

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function buildDlqRetryListenerProviders(): readonly DlqRetryListenerProvider[] {
  return [buildGenericSourceListenerProvider()];
}

function buildGenericSourceListenerProvider(): DlqRetryListenerProvider {
  return {
    supports: () => true,
    make: async (input) => {
      const plugins = buildDefaultBackfillSourcePlugins(NOOP_LOGGER);
      const plugin = plugins.find(
        (candidate) => candidate.sourceType === input.archiveSourceType,
      ) as SourceIngester<unknown> | undefined;

      if (plugin == null) {
        throw new Error(`unsupported source_type: ${input.archiveSourceType}`);
      }

      const parsedConfig = plugin.parseConfig(input.sourceConfig);
      const spec = plugin.buildIngestSpec(
        {
          daoSourceId: input.daoSourceId,
          sourceType: input.archiveSourceType as SourceType,
          chainId: input.archiveChainId,
          sourceLabel: input.archiveSourceType as SourceType,
        },
        parsedConfig,
      );

      if (spec.kind !== 'evm-event-poller') {
        throw new Error(
          `dlq retry expects evm-event-poller ingest spec for source_type=${input.archiveSourceType}`,
        );
      }

      return spec.listener;
    },
  };
}
