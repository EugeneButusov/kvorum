import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeAavePayloadsControllerLog } from '../abi/decoder';
import { AAVE_PAYLOADS_CONTROLLER_TOPICS } from '../abi/events';
import { AavePayloadsControllerArchiveWriter } from '../ingestion/archive-writer';
import { makeAavePayloadsControllerIngesterListener } from '../ingestion/ingester-listener';

export const AavePayloadsControllerConfigSchema = z.object({
  payloads_controller_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type AavePayloadsControllerConfig = z.infer<typeof AavePayloadsControllerConfigSchema>;

export const AAVE_PAYLOADS_CONTROLLER_SUPPORTED_CHAIN_IDS = [
  '0x1',
  '0x89',
  '0xa86a',
  '0xa4b1',
  '0xa',
  '0x2105',
  '0x64',
  '0x38',
  '0x82750',
  '0xe708',
  '0xa4ec',
  '0x92',
  '0x440',
  '0x144',
] as const;

export interface AavePayloadsControllerPluginDeps {
  archiveWriter: AavePayloadsControllerArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createAavePayloadsControllerPlugin(
  deps: AavePayloadsControllerPluginDeps,
): SourceIngester<AavePayloadsControllerConfig> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<AavePayloadsControllerConfig>['buildIngestSpec']>[0],
    cfg: AavePayloadsControllerConfig,
  ): BackfillRuntime => ({
    filter: {
      address: cfg.payloads_controller_address.toLowerCase(),
      topics: [
        [
          AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCreated,
          AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadQueued,
          AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadExecuted,
          AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCancelled,
        ],
      ],
    },
    listenerFactory: () =>
      makeAavePayloadsControllerIngesterListener(
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
    sourceType: 'aave_payloads_controller',
    supportedChainIds: AAVE_PAYLOADS_CONTROLLER_SUPPORTED_CHAIN_IDS,
    transport: 'evm',
    parseConfig: (raw) => AavePayloadsControllerConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: cfg.payloads_controller_address.toLowerCase(),
        topics: [
          [
            AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCreated,
            AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadQueued,
            AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadExecuted,
            AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCancelled,
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
      const decoded = decodeAavePayloadsControllerLog(logRef, ctx.sourceType);
      await deps.archiveWriter.writeCore(ctx, decoded, logRef);
    },
  };
}
