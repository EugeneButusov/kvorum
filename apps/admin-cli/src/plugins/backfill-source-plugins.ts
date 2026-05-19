import type { Logger } from '@libs/chain';
import { chDb, ConfirmationRepository, DlqRepository, pgDb, type SourceType } from '@libs/db';
import {
  ArchiveWriter,
  EventRepository,
  createCompoundPlugins,
  type CompoundGovernorConfig,
  type CompoundGovernorPluginDeps,
} from '@sources/compound';
import type { BackfillRuntime, SourcePlugin } from '@sources/core';

export type BackfillSourcePlugin = SourcePlugin<CompoundGovernorConfig>;

export function buildBackfillSourcePlugins(
  deps: CompoundGovernorPluginDeps,
): readonly BackfillSourcePlugin[] {
  return createCompoundPlugins(deps);
}

export function resolveBackfillSourcePlugin(
  sourceType: SourceType,
  plugins: readonly BackfillSourcePlugin[],
): BackfillSourcePlugin | undefined {
  return plugins.find((plugin) => plugin.sourceType === sourceType);
}

export interface BackfillSourceRuntimeInput {
  daoSourceId: string;
  sourceType: SourceType;
  sourceConfig: unknown;
  chainId: string;
  logger: Logger;
}

export function buildBackfillSourceRuntime(input: BackfillSourceRuntimeInput): BackfillRuntime {
  const archiveWriter = new ArchiveWriter({
    eventRepo: new EventRepository({ chDb }),
    confirmationRepo: new ConfirmationRepository(pgDb),
    dlqRepo: new DlqRepository(pgDb),
    logger: input.logger,
  });
  const dlqRepo = new DlqRepository(pgDb);
  const plugins = buildBackfillSourcePlugins({ archiveWriter, dlqRepo, logger: input.logger });
  const plugin = resolveBackfillSourcePlugin(input.sourceType, plugins);
  if (plugin == null) {
    throw new Error(`unsupported source_type: ${input.sourceType}`);
  }

  const parsedConfig = plugin.parseConfig(input.sourceConfig);
  return plugin.buildBackfillRuntime(
    {
      daoSourceId: input.daoSourceId,
      sourceType: input.sourceType,
      chainId: input.chainId,
      sourceLabel: input.sourceType,
    },
    parsedConfig,
  );
}
