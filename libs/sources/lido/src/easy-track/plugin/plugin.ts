import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeEasyTrackLog } from '../abi/decoder';
import { EASY_TRACK_TOPICS } from '../abi/events';
import { LidoEasyTrackArchiveWriter } from '../ingestion/archive-writer';
import { makeEasyTrackIngesterListener } from '../ingestion/ingester-listener';

// One `easy_track` source watches the single EasyTrack contract for all motion-lifecycle + settings
// events. The EVMScriptExecutor (carried in config for the later EVMScript-action decoder) emits no
// motion events and is intentionally NOT in the watched address set.
export const LidoEasyTrackConfigSchema = z.object({
  easy_track_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  evm_script_executor_address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

export type LidoEasyTrackConfig = z.infer<typeof LidoEasyTrackConfigSchema>;

export const SUPPORTED_CHAIN_IDS = ['0x1'] as const;

const ALL_TOPICS = [...Object.values(EASY_TRACK_TOPICS)];

export interface LidoEasyTrackPluginDeps {
  archiveWriter: LidoEasyTrackArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createLidoEasyTrackPlugin(
  deps: LidoEasyTrackPluginDeps,
): SourceIngester<LidoEasyTrackConfig> {
  const addressesOf = (cfg: LidoEasyTrackConfig): string[] => [
    cfg.easy_track_address.toLowerCase(),
  ];

  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<LidoEasyTrackConfig>['buildIngestSpec']>[0],
    cfg: LidoEasyTrackConfig,
  ): BackfillRuntime => ({
    filter: {
      address: addressesOf(cfg),
      topics: [ALL_TOPICS],
    },
    listenerFactory: () =>
      makeEasyTrackIngesterListener(
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
    sourceType: 'easy_track',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => LidoEasyTrackConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: addressesOf(cfg),
        topics: [ALL_TOPICS],
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
      const decoded = decodeEasyTrackLog(logRef, ctx.sourceType);
      await deps.archiveWriter.writeCore(ctx, decoded, logRef);
    },
  };
}
