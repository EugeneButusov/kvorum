import { z } from 'zod';
import type { Logger } from '@libs/chain';
import type { DlqRepository, SourceType } from '@libs/db';
import type { BackfillRuntime, SourcePlugin } from '@sources/core';
import { interfaceForSource } from '../abi/events';
import { ArchiveWriter } from '../ingestion/archive-writer';
import { makeIngesterListener } from '../ingestion/ingester-listener';

export const DaoSourceConfigSchema = z.object({
  governor_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type CompoundGovernorConfig = z.infer<typeof DaoSourceConfigSchema>;

export const SUPPORTED_CHAIN_IDS = ['0x1'] as const;

export interface CompoundGovernorPluginDeps {
  archiveWriter: ArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

function createPlugin(
  sourceType: SourceType,
  deps: CompoundGovernorPluginDeps,
): SourcePlugin<CompoundGovernorConfig> {
  const buildBackfillRuntime = (
    ctx: Parameters<SourcePlugin<CompoundGovernorConfig>['buildIngestSpec']>[0],
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
      listenerFactory: (classifier) =>
        makeIngesterListener(
          {
            archiveWriter: deps.archiveWriter,
            context: { ...ctx, confirmationClassifier: classifier },
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
    buildIngestSpec: (ctx, cfg) => {
      const runtime = buildBackfillRuntime(ctx, cfg);
      return {
        kind: 'evm-event-poller',
        filter: runtime.filter,
        listener: runtime.listenerFactory(() => 'pending'),
      };
    },
    buildBackfillRuntime,
  };
}

export function createCompoundGovernorBravoPlugin(
  deps: CompoundGovernorPluginDeps,
): SourcePlugin<CompoundGovernorConfig> {
  return createPlugin('compound_governor_bravo', deps);
}

export function createCompoundGovernorAlphaPlugin(
  deps: CompoundGovernorPluginDeps,
): SourcePlugin<CompoundGovernorConfig> {
  return createPlugin('compound_governor_alpha', deps);
}

export function createCompoundGovernorOzPlugin(
  deps: CompoundGovernorPluginDeps,
): SourcePlugin<CompoundGovernorConfig> {
  return createPlugin('compound_governor_oz', deps);
}

export function createCompoundPlugins(
  deps: CompoundGovernorPluginDeps,
): readonly SourcePlugin<CompoundGovernorConfig>[] {
  return [
    createCompoundGovernorBravoPlugin(deps),
    createCompoundGovernorAlphaPlugin(deps),
    createCompoundGovernorOzPlugin(deps),
  ] as const;
}
