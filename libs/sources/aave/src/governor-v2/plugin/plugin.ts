import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeAaveGovernorV2Log } from '../abi/decoder';
import { AAVE_GOVERNOR_V2_TOPICS } from '../abi/events';
import { AaveGovernorV2ArchiveWriter } from '../ingestion/archive-writer';
import { makeAaveGovernorV2IngesterListener } from '../ingestion/ingester-listener';

export const AaveGovernorV2ConfigSchema = z.object({
  governor_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type AaveGovernorV2Config = z.infer<typeof AaveGovernorV2ConfigSchema>;

export const SUPPORTED_CHAIN_IDS = ['0x1'] as const;

export interface AaveGovernorV2PluginDeps {
  archiveWriter: AaveGovernorV2ArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createAaveGovernorV2Plugin(
  deps: AaveGovernorV2PluginDeps,
): SourceIngester<AaveGovernorV2Config> {
  const allTopics = [
    AAVE_GOVERNOR_V2_TOPICS.ProposalCreated,
    AAVE_GOVERNOR_V2_TOPICS.VoteEmitted,
    AAVE_GOVERNOR_V2_TOPICS.ProposalQueued,
    AAVE_GOVERNOR_V2_TOPICS.ProposalExecuted,
    AAVE_GOVERNOR_V2_TOPICS.ProposalCanceled,
  ];

  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<AaveGovernorV2Config>['buildIngestSpec']>[0],
    cfg: AaveGovernorV2Config,
  ): BackfillRuntime => ({
    filter: {
      address: cfg.governor_address.toLowerCase(),
      topics: [allTopics],
    },
    listenerFactory: () =>
      makeAaveGovernorV2IngesterListener(
        {
          archiveWriter: deps.archiveWriter,
          context: { ...ctx },
          logger: deps.logger,
          dlqRepo: deps.dlqRepo,
        },
        { onWriteFailure: 'throw' },
      ),
  });

  return {
    sourceType: 'aave_governor_v2',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    capabilities: ['backfillable'],
    parseConfig: (raw) => AaveGovernorV2ConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: cfg.governor_address.toLowerCase(),
        topics: [allTopics],
      },
    }),
    buildBackfillRuntime,
    buildArchiveConsumer: (): ArchiveConsumeFn => async (ctx, raw) => {
      const logRef: LogEvent = {
        sourceType: ctx.sourceType,
        chainId: raw.chainId,
        blockNumber: BigInt(raw.blockNumber),
        blockHash: raw.blockHash,
        txHash: raw.txHash,
        txIndex: 0,
        logIndex: raw.logIndex,
        address: raw.address,
        topics: raw.topics,
        data: raw.data,
      };
      const decoded = decodeAaveGovernorV2Log(logRef, ctx.sourceType);
      await deps.archiveWriter.writeCore(ctx, decoded, logRef);
    },
  };
}
