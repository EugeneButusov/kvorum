import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { SNAPSHOT_DELEGATION_CHAIN_ID, SPLIT_DELEGATION_ADDRESS } from '../../delegation/constants';
import { decodeSplitDelegationLog } from '../abi/decoder';
import { SPLIT_DELEGATION_TOPICS } from '../abi/events';
import { isTrackedSplitDelegation } from '../domain/context-filter';
import type { SplitDelegationArchiveWriter } from '../ingestion/archive-writer';
import { makeSplitDelegationIngesterListener } from '../ingestion/ingester-listener';

export const SplitDelegationConfigSchema = z
  .object({
    registry_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  })
  .refine((cfg) => cfg.registry_address.toLowerCase() === SPLIT_DELEGATION_ADDRESS, {
    message: `registry_address must equal the Split Delegation registry ${SPLIT_DELEGATION_ADDRESS}`,
    path: ['registry_address'],
  });

export type SplitDelegationConfig = z.infer<typeof SplitDelegationConfigSchema>;

export const SPLIT_DELEGATION_SUPPORTED_CHAIN_IDS = [SNAPSHOT_DELEGATION_CHAIN_ID] as const;

export interface SplitDelegationPluginDeps {
  archiveWriter: SplitDelegationArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

// `context` (the space) is un-indexed, so the topic filter can only narrow by event signature;
// the per-space scope is enforced post-decode (isTrackedSplitDelegation) on both ingest paths.
function buildFilter(address: string) {
  return {
    address: address.toLowerCase(),
    topics: [
      [
        SPLIT_DELEGATION_TOPICS.DelegationUpdated,
        SPLIT_DELEGATION_TOPICS.DelegationCleared,
        SPLIT_DELEGATION_TOPICS.ExpirationUpdated,
        SPLIT_DELEGATION_TOPICS.OptOutStatusSet,
      ],
    ] as (string[] | null)[],
  };
}

export function createSplitDelegationPlugin(
  deps: SplitDelegationPluginDeps,
): SourceIngester<SplitDelegationConfig> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<SplitDelegationConfig>['buildIngestSpec']>[0],
    cfg: SplitDelegationConfig,
  ): BackfillRuntime => ({
    filter: buildFilter(cfg.registry_address),
    listenerFactory: () =>
      makeSplitDelegationIngesterListener(
        {
          archiveWriter: deps.archiveWriter,
          context: { ...ctx },
          logger: deps.logger,
          dlqRepo: deps.dlqRepo,
        },
        { onWriteFailure: 'throw', filter: isTrackedSplitDelegation },
      ),
  });

  return {
    sourceType: 'snapshot_split_delegation',
    supportedChainIds: SPLIT_DELEGATION_SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => SplitDelegationConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: buildFilter(cfg.registry_address),
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
      const decoded = decodeSplitDelegationLog(logRef); // throws DecodeError
      // Drop out-of-scope spaces before any archive write (context is un-indexed).
      if (!isTrackedSplitDelegation(decoded)) return;
      await deps.archiveWriter.writeCore(ctx, decoded, logRef); // throws on transient
    },
  };
}
