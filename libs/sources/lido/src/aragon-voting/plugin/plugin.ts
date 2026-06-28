import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeAragonVotingLog } from '../abi/decoder';
import { ARAGON_VOTING_TOPICS } from '../abi/events';
import { LidoAragonVotingArchiveWriter } from '../ingestion/archive-writer';
import { makeAragonVotingIngesterListener } from '../ingestion/ingester-listener';

export const LidoAragonVotingConfigSchema = z.object({
  voting_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type LidoAragonVotingConfig = z.infer<typeof LidoAragonVotingConfigSchema>;

export const SUPPORTED_CHAIN_IDS = ['0x1'] as const;

export interface LidoAragonVotingPluginDeps {
  archiveWriter: LidoAragonVotingArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createLidoAragonVotingPlugin(
  deps: LidoAragonVotingPluginDeps,
): SourceIngester<LidoAragonVotingConfig> {
  const allTopics = [
    ARAGON_VOTING_TOPICS.StartVote,
    ARAGON_VOTING_TOPICS.CastVote,
    ARAGON_VOTING_TOPICS.CastObjection,
    ARAGON_VOTING_TOPICS.ExecuteVote,
    ARAGON_VOTING_TOPICS.ChangeSupportRequired,
    ARAGON_VOTING_TOPICS.ChangeMinQuorum,
    ARAGON_VOTING_TOPICS.ChangeVoteTime,
    ARAGON_VOTING_TOPICS.ChangeObjectionPhaseTime,
  ];

  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<LidoAragonVotingConfig>['buildIngestSpec']>[0],
    cfg: LidoAragonVotingConfig,
  ): BackfillRuntime => ({
    filter: {
      address: cfg.voting_address.toLowerCase(),
      topics: [allTopics],
    },
    listenerFactory: () =>
      makeAragonVotingIngesterListener(
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
    sourceType: 'aragon_voting',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => LidoAragonVotingConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: cfg.voting_address.toLowerCase(),
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
      const decoded = decodeAragonVotingLog(logRef, ctx.sourceType);
      await deps.archiveWriter.writeCore(ctx, decoded, logRef);
    },
  };
}
