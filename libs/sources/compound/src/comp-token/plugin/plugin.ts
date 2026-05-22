import { z } from 'zod';
import type { Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { BackfillRuntime, SourceIngester } from '@sources/core';
import { COMPOUND_COMP_TOKEN_TOPICS } from '../abi/events';
import { COMP_TOKEN_ADDRESS } from '../constants';
import type { CompTokenArchiveWriter } from '../ingestion/archive-writer';
import { makeCompTokenIngesterListener } from '../ingestion/ingester-listener';

export const CompTokenSourceConfigSchema = z
  .object({
    token_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  })
  .refine((cfg) => cfg.token_address.toLowerCase() === COMP_TOKEN_ADDRESS.toLowerCase(), {
    message: `token_address must equal canonical COMP token ${COMP_TOKEN_ADDRESS}`,
    path: ['token_address'],
  });

export type CompTokenSourceConfig = z.infer<typeof CompTokenSourceConfigSchema>;

export const COMP_TOKEN_SUPPORTED_CHAIN_IDS = ['0x1'] as const;

export interface CompTokenPluginDeps {
  archiveWriter: CompTokenArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createCompTokenPlugin(
  deps: CompTokenPluginDeps,
): SourceIngester<CompTokenSourceConfig> {
  const buildRuntime = (
    ctx: Parameters<SourceIngester<CompTokenSourceConfig>['buildIngestSpec']>[0],
    cfg: CompTokenSourceConfig,
  ): BackfillRuntime => ({
    filter: {
      address: cfg.token_address.toLowerCase(),
      topics: [
        [
          COMPOUND_COMP_TOKEN_TOPICS.DelegateChanged,
          COMPOUND_COMP_TOKEN_TOPICS.DelegateVotesChanged,
        ],
      ],
    },
    listenerFactory: (classifier) =>
      makeCompTokenIngesterListener(
        {
          archiveWriter: deps.archiveWriter,
          context: { ...ctx, confirmationClassifier: classifier },
          logger: deps.logger,
          dlqRepo: deps.dlqRepo,
        },
        { onWriteFailure: 'throw' },
      ),
  });

  return {
    sourceType: 'compound_comp_token',
    supportedChainIds: COMP_TOKEN_SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => CompTokenSourceConfigSchema.parse(raw),
    buildIngestSpec: (ctx, cfg) => {
      const runtime = buildRuntime(ctx, cfg);
      return {
        kind: 'evm-event-poller',
        filter: runtime.filter,
        listener: runtime.listenerFactory(() => 'pending'),
      };
    },
    buildBackfillRuntime: buildRuntime,
  };
}
