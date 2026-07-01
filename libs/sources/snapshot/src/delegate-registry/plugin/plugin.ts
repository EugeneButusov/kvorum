import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { GLOBAL_SPACE_ID, encodeSpaceId } from '../../delegation/address';
import {
  DELEGATE_REGISTRY_ADDRESS,
  SNAPSHOT_DELEGATION_CHAIN_ID,
  SNAPSHOT_DELEGATION_SPACES,
} from '../../delegation/constants';
import { decodeDelegateRegistryLog } from '../abi/decoder';
import { DELEGATE_REGISTRY_TOPICS } from '../abi/events';
import type { DelegateRegistryArchiveWriter } from '../ingestion/archive-writer';
import { makeDelegateRegistryIngesterListener } from '../ingestion/ingester-listener';

export const DelegateRegistryConfigSchema = z
  .object({
    registry_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  })
  .refine((cfg) => cfg.registry_address.toLowerCase() === DELEGATE_REGISTRY_ADDRESS, {
    message: `registry_address must equal the Gnosis Delegate Registry ${DELEGATE_REGISTRY_ADDRESS}`,
    path: ['registry_address'],
  });

export type DelegateRegistryConfig = z.infer<typeof DelegateRegistryConfigSchema>;

export const DELEGATE_REGISTRY_SUPPORTED_CHAIN_IDS = [SNAPSHOT_DELEGATION_CHAIN_ID] as const;

export interface DelegateRegistryPluginDeps {
  archiveWriter: DelegateRegistryArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

// topic[0] = event sigs, topic[1] = delegator (any), topic[2] = the space id, scoped to the
// seeded spaces + the global id (id is indexed, so this bounds the firehose to our delegations).
function buildFilter(address: string) {
  const spaceIds = [GLOBAL_SPACE_ID, ...SNAPSHOT_DELEGATION_SPACES.map(encodeSpaceId)];
  return {
    address: address.toLowerCase(),
    topics: [
      [DELEGATE_REGISTRY_TOPICS.SetDelegate, DELEGATE_REGISTRY_TOPICS.ClearDelegate],
      null,
      spaceIds,
    ] as (string[] | null)[],
  };
}

export function createDelegateRegistryPlugin(
  deps: DelegateRegistryPluginDeps,
): SourceIngester<DelegateRegistryConfig> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<DelegateRegistryConfig>['buildIngestSpec']>[0],
    cfg: DelegateRegistryConfig,
  ): BackfillRuntime => ({
    filter: buildFilter(cfg.registry_address),
    listenerFactory: () =>
      makeDelegateRegistryIngesterListener(
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
    sourceType: 'snapshot_delegate_registry',
    supportedChainIds: DELEGATE_REGISTRY_SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => DelegateRegistryConfigSchema.parse(raw),
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
      const decoded = decodeDelegateRegistryLog(logRef); // throws DecodeError
      await deps.archiveWriter.writeCore(ctx, decoded, logRef); // throws on transient
    },
  };
}
