import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeDualGovernanceLog } from '../abi/decoder';
import { DUAL_GOVERNANCE_TOPICS, TIMELOCK_TOPICS } from '../abi/events';
import { LidoDualGovernanceArchiveWriter } from '../ingestion/archive-writer';
import { makeDualGovernanceIngesterListener } from '../ingestion/ingester-listener';

// One `dual_governance` source watches two addresses: the DualGovernance contract (state machine +
// governance-layer proposal/proposer events) and the EmergencyProtectedTimelock (proposal lifecycle).
// SourceResolver registers every address in the array to this source, so logs from either resolve to
// `dual_governance`. The legacy DG is intentionally NOT here (deferred — its ABI is unverified).
export const LidoDualGovernanceConfigSchema = z.object({
  dual_governance_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  timelock_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type LidoDualGovernanceConfig = z.infer<typeof LidoDualGovernanceConfigSchema>;

export const SUPPORTED_CHAIN_IDS = ['0x1'] as const;

const ALL_TOPICS = [...Object.values(DUAL_GOVERNANCE_TOPICS), ...Object.values(TIMELOCK_TOPICS)];

export interface LidoDualGovernancePluginDeps {
  archiveWriter: LidoDualGovernanceArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

export function createLidoDualGovernancePlugin(
  deps: LidoDualGovernancePluginDeps,
): SourceIngester<LidoDualGovernanceConfig> {
  const addressesOf = (cfg: LidoDualGovernanceConfig): string[] => [
    cfg.dual_governance_address.toLowerCase(),
    cfg.timelock_address.toLowerCase(),
  ];

  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<LidoDualGovernanceConfig>['buildIngestSpec']>[0],
    cfg: LidoDualGovernanceConfig,
  ): BackfillRuntime => ({
    filter: {
      address: addressesOf(cfg),
      topics: [ALL_TOPICS],
    },
    listenerFactory: () =>
      makeDualGovernanceIngesterListener(
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
    sourceType: 'dual_governance',
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => LidoDualGovernanceConfigSchema.parse(raw),
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
      const decoded = decodeDualGovernanceLog(logRef, ctx.sourceType);
      await deps.archiveWriter.writeCore(ctx, decoded, logRef);
    },
  };
}
