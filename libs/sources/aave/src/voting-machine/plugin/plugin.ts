import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeAaveVotingMachineLog } from '../abi/decoder';
import { AAVE_VOTING_MACHINE_TOPICS } from '../abi/events';
import { AaveVotingMachineArchiveWriter } from '../ingestion/archive-writer';
import { makeAaveVotingMachineIngesterListener } from '../ingestion/ingester-listener';

export const AaveVotingMachineConfigSchema = z.object({
  voting_machine_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type AaveVotingMachineConfig = z.infer<typeof AaveVotingMachineConfigSchema>;

export const AAVE_VOTING_MACHINE_SUPPORTED_CHAIN_IDS = ['0x1', '0x89', '0xa86a'] as const;

export interface AaveVotingMachinePluginDeps {
  archiveWriter: AaveVotingMachineArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createAaveVotingMachinePlugin(
  deps: AaveVotingMachinePluginDeps,
): SourceIngester<AaveVotingMachineConfig> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<AaveVotingMachineConfig>['buildIngestSpec']>[0],
    cfg: AaveVotingMachineConfig,
  ): BackfillRuntime => ({
    filter: {
      address: cfg.voting_machine_address.toLowerCase(),
      topics: [
        [
          AAVE_VOTING_MACHINE_TOPICS.VoteEmitted,
          AAVE_VOTING_MACHINE_TOPICS.ProposalVoteStarted,
          AAVE_VOTING_MACHINE_TOPICS.ProposalResultsSent,
          AAVE_VOTING_MACHINE_TOPICS.ProposalVoteConfigurationBridged,
        ],
      ],
    },
    listenerFactory: () =>
      makeAaveVotingMachineIngesterListener(
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
    sourceType: 'aave_voting_machine',
    supportedChainIds: AAVE_VOTING_MACHINE_SUPPORTED_CHAIN_IDS,
    capabilities: ['backfillable'],
    parseConfig: (raw) => AaveVotingMachineConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: cfg.voting_machine_address.toLowerCase(),
        topics: [
          [
            AAVE_VOTING_MACHINE_TOPICS.VoteEmitted,
            AAVE_VOTING_MACHINE_TOPICS.ProposalVoteStarted,
            AAVE_VOTING_MACHINE_TOPICS.ProposalResultsSent,
            AAVE_VOTING_MACHINE_TOPICS.ProposalVoteConfigurationBridged,
          ],
        ],
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
      const decoded = decodeAaveVotingMachineLog(logRef, ctx.sourceType);
      await deps.archiveWriter.writeCore(ctx, decoded, logRef);
    },
  };
}
