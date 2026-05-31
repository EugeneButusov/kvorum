import { z } from 'zod';
import type { LogEvent, Logger } from '@libs/chain';
import type { DlqRepository, SourceType } from '@libs/db';
import type { ArchiveConsumeFn, BackfillRuntime, SourceIngester } from '@sources/core';
import { decodeCompoundLog } from '../abi/decoder';
import { interfaceForSource } from '../abi/events';
import { GovernorArchiveWriter } from '../ingestion/archive-writer';
import { makeIngesterListener } from '../ingestion/ingester-listener';

export const DaoSourceConfigSchema = z.object({
  governor_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type CompoundGovernorConfig = z.infer<typeof DaoSourceConfigSchema>;

export const SUPPORTED_CHAIN_IDS = ['0x1'] as const;

export interface CompoundGovernorPluginDeps {
  archiveWriter: GovernorArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

function createPlugin(
  sourceType: SourceType,
  deps: CompoundGovernorPluginDeps,
): SourceIngester<CompoundGovernorConfig> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourceIngester<CompoundGovernorConfig>['buildIngestSpec']>[0],
    cfg: CompoundGovernorConfig,
  ): BackfillRuntime => {
    const topics = interfaceForSource(sourceType).topics;
    const proposalTopics = [
      topics.ProposalCreated,
      topics.ProposalQueued,
      topics.ProposalExecuted,
      topics.ProposalCanceled,
    ];

    return {
      filter: {
        address: cfg.governor_address.toLowerCase(),
        topics: [[...proposalTopics, topics.VoteCast]],
      },
      listenerFactory: () =>
        makeIngesterListener(
          {
            archiveWriter: deps.archiveWriter,
            context: { ...ctx },
            logger: deps.logger,
            dlqRepo: deps.dlqRepo,
          },
          { onWriteFailure: 'throw' },
        ),
    };
  };

  return {
    sourceType,
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    parseConfig: (raw) => DaoSourceConfigSchema.parse(raw),
    buildIngestSpec: (_ctx, cfg) => {
      const topics = interfaceForSource(sourceType).topics;
      // listener omitted — EvmEventPollerDriver supplies the generic archive producer for live path
      return {
        kind: 'evm-event-poller',
        filter: {
          address: cfg.governor_address.toLowerCase(),
          topics: [
            [
              topics.ProposalCreated,
              topics.ProposalQueued,
              topics.ProposalExecuted,
              topics.ProposalCanceled,
              topics.VoteCast,
            ],
          ],
        },
      };
    },
    buildBackfillRuntime,
    buildArchiveConsumer: (): ArchiveConsumeFn => async (ctx, raw) => {
      const logRef: LogEvent = {
        sourceType: ctx.sourceType,
        chainId: raw.chainId,
        blockNumber: BigInt(raw.blockNumber),
        blockHash: raw.blockHash,
        txHash: raw.txHash,
        txIndex: 0, // unused by archive writes; synthesized per plan M4
        logIndex: raw.logIndex,
        address: raw.address,
        topics: raw.topics,
        data: raw.data,
      };
      const decoded = decodeCompoundLog(logRef, ctx.sourceType); // throws DecodeError
      await deps.archiveWriter.writeCore(ctx, decoded, logRef); // throws on transient
    },
  };
}

export function createCompoundGovernorBravoPlugin(
  deps: CompoundGovernorPluginDeps,
): SourceIngester<CompoundGovernorConfig> {
  return createPlugin('compound_governor_bravo', deps);
}

export function createCompoundGovernorAlphaPlugin(
  deps: CompoundGovernorPluginDeps,
): SourceIngester<CompoundGovernorConfig> {
  return createPlugin('compound_governor_alpha', deps);
}

export function createCompoundGovernorOzPlugin(
  deps: CompoundGovernorPluginDeps,
): SourceIngester<CompoundGovernorConfig> {
  return createPlugin('compound_governor_oz', deps);
}

export function createCompoundPlugins(
  deps: CompoundGovernorPluginDeps,
): readonly SourceIngester<CompoundGovernorConfig>[] {
  return [
    createCompoundGovernorBravoPlugin(deps),
    createCompoundGovernorAlphaPlugin(deps),
    createCompoundGovernorOzPlugin(deps),
  ] as const;
}
