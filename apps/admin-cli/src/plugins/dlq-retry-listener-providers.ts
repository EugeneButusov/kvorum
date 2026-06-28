import type { Logger } from '@libs/chain';
import type { SourceType } from '@libs/db';
import type { SourceIngester } from '@sources/core';
import { buildDefaultBackfillSourcePlugins } from './backfill-source-plugins.js';
import type { DlqRetryListenerProvider } from '../commands/dlq-retry-listener-factory.js';

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
      const ctx = {
        daoSourceId: input.daoSourceId,
        sourceType: input.archiveSourceType as SourceType,
        chainId: input.archiveChainId,
        sourceLabel: input.archiveSourceType as SourceType,
      };
      // Use buildBackfillRuntime — it always supplies a domain listener with the archive writer.
      // buildIngestSpec no longer provides a listener (live path uses the generic producer instead).
      // Reconcile/off-chain sources have no backfill runtime (no `backfillable` capability) and never
      // produce archive events, so a DLQ row for one is not retryable.
      if (plugin.buildBackfillRuntime == null) {
        throw new Error(
          `source_type "${input.archiveSourceType}" has no backfill runtime to retry`,
        );
      }
      const runtime = plugin.buildBackfillRuntime(ctx, parsedConfig);
      const listener = runtime.listenerFactory();

      return listener;
    },
  };
}
