import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeAaveGovernanceV3Log } from '../abi/decoder';
import { AAVE_GOVERNANCE_V3_TOPICS } from '../abi/events';
import { AaveGovernanceArchiveWriter } from '../ingestion/archive-writer';
import { makeAaveGovernanceIngesterListener } from '../ingestion/ingester-listener';

export const AaveGovernanceV3ConfigSchema = z.object({
  governance_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type AaveGovernanceV3Config = z.infer<typeof AaveGovernanceV3ConfigSchema>;

export const SUPPORTED_CHAIN_IDS = ['0x1'] as const;

export interface AaveGovernanceV3PluginDeps {
  archiveWriter: AaveGovernanceArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createAaveGovernanceV3Plugin(
  deps: AaveGovernanceV3PluginDeps,
): SourceIngester<AaveGovernanceV3Config> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<AaveGovernanceV3Config>['buildIngestSpec']>[0],
    cfg: AaveGovernanceV3Config,
  ): BackfillRuntime => ({
    filter: {
      address: cfg.governance_address.toLowerCase(),
      topics: [
        [
          AAVE_GOVERNANCE_V3_TOPICS.ProposalCreated,
          AAVE_GOVERNANCE_V3_TOPICS.VotingActivated,
          AAVE_GOVERNANCE_V3_TOPICS.ProposalQueued,
          AAVE_GOVERNANCE_V3_TOPICS.ProposalExecuted,
          AAVE_GOVERNANCE_V3_TOPICS.ProposalCanceled,
          AAVE_GOVERNANCE_V3_TOPICS.ProposalFailed,
          AAVE_GOVERNANCE_V3_TOPICS.PayloadSent,
        ],
      ],
    },
    listenerFactory: () =>
      makeAaveGovernanceIngesterListener(
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
    sourceType: 'aave_governance_v3',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    transport: 'evm',
    parseConfig: (raw) => AaveGovernanceV3ConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: cfg.governance_address.toLowerCase(),
        topics: [
          [
            AAVE_GOVERNANCE_V3_TOPICS.ProposalCreated,
            AAVE_GOVERNANCE_V3_TOPICS.VotingActivated,
            AAVE_GOVERNANCE_V3_TOPICS.ProposalQueued,
            AAVE_GOVERNANCE_V3_TOPICS.ProposalExecuted,
            AAVE_GOVERNANCE_V3_TOPICS.ProposalCanceled,
            AAVE_GOVERNANCE_V3_TOPICS.ProposalFailed,
            AAVE_GOVERNANCE_V3_TOPICS.PayloadSent,
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
      const decoded = decodeAaveGovernanceV3Log(logRef, ctx.sourceType);
      await deps.archiveWriter.writeCore(ctx, decoded, logRef);
    },
  };
}
