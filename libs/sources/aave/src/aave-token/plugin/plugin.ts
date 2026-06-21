import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeAaveTokenLog } from '../abi/decoder';
import { AAVE_TOKEN_TOPICS } from '../abi/events';
import { AAVE_TOKEN_ADDRESS } from '../constants';
import type { AaveTokenArchiveWriter } from '../ingestion/archive-writer';
import { makeAaveTokenIngesterListener } from '../ingestion/ingester-listener';

export const AaveTokenConfigSchema = z
  .object({
    token_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  })
  .refine((cfg) => cfg.token_address.toLowerCase() === AAVE_TOKEN_ADDRESS.toLowerCase(), {
    message: `token_address must equal canonical AAVE token ${AAVE_TOKEN_ADDRESS}`,
    path: ['token_address'],
  });

export type AaveTokenConfig = z.infer<typeof AaveTokenConfigSchema>;

// AAVE/stkAAVE/aAAVE governance power lives only on Ethereum mainnet; delegation is mainnet-only.
export const AAVE_TOKEN_SUPPORTED_CHAIN_IDS = ['0x1'] as const;

export interface AaveTokenPluginDeps {
  archiveWriter: AaveTokenArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createAaveTokenPlugin(deps: AaveTokenPluginDeps): SourceIngester<AaveTokenConfig> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<AaveTokenConfig>['buildIngestSpec']>[0],
    cfg: AaveTokenConfig,
  ): BackfillRuntime => ({
    filter: {
      address: cfg.token_address.toLowerCase(),
      topics: [[AAVE_TOKEN_TOPICS.DelegateChanged]],
    },
    listenerFactory: () =>
      makeAaveTokenIngesterListener(
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
    sourceType: 'aave_token',
    supportedChainIds: AAVE_TOKEN_SUPPORTED_CHAIN_IDS,
    capabilities: ['backfillable'],
    parseConfig: (raw) => AaveTokenConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: cfg.token_address.toLowerCase(),
        topics: [[AAVE_TOKEN_TOPICS.DelegateChanged]],
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
      const decoded = decodeAaveTokenLog(logRef); // throws DecodeError
      await deps.archiveWriter.writeCore(ctx, decoded, logRef); // throws on transient
    },
  };
}
