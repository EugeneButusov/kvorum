import type { Logger } from '@libs/chain';
import { chDb, ConfirmationRepository, DlqRepository, pgDb, type SourceType } from '@libs/db';
import {
  ArchiveWriter as GovernorArchiveWriter,
  CompTokenArchiveWriter,
  CompTokenEventRepository,
  createCompTokenPlugin,
  EventRepository as GovernorEventRepository,
  createCompoundPlugins,
  type CompoundGovernorConfig,
  type CompoundGovernorPluginDeps,
  type CompTokenPluginDeps,
  type CompTokenSourceConfig,
} from '@sources/compound';
import type { BackfillRuntime, SourcePlugin } from '@sources/core';

export type BackfillSourcePlugin =
  | SourcePlugin<CompoundGovernorConfig>
  | SourcePlugin<CompTokenSourceConfig>;

export function buildBackfillSourcePlugins(deps: {
  governor: CompoundGovernorPluginDeps;
  compToken: CompTokenPluginDeps;
}): readonly BackfillSourcePlugin[] {
  return [...createCompoundPlugins(deps.governor), createCompTokenPlugin(deps.compToken)];
}

export interface BackfillSourceRuntimeInput {
  daoSourceId: string;
  sourceType: SourceType;
  sourceConfig: unknown;
  chainId: string;
  logger: Logger;
}

export function buildBackfillSourceRuntime(input: BackfillSourceRuntimeInput): BackfillRuntime {
  const governorArchiveWriter = new GovernorArchiveWriter({
    eventRepo: new GovernorEventRepository({ chDb }),
    confirmationRepo: new ConfirmationRepository(pgDb),
    dlqRepo: new DlqRepository(pgDb),
    logger: input.logger,
  });
  const compTokenArchiveWriter = new CompTokenArchiveWriter({
    eventRepo: new CompTokenEventRepository({ chDb }),
    confirmationRepo: new ConfirmationRepository(pgDb),
    dlqRepo: new DlqRepository(pgDb),
    logger: input.logger,
  });
  const dlqRepo = new DlqRepository(pgDb);
  const plugins = buildBackfillSourcePlugins({
    governor: { archiveWriter: governorArchiveWriter, dlqRepo, logger: input.logger },
    compToken: { archiveWriter: compTokenArchiveWriter, dlqRepo, logger: input.logger },
  });
  const resolved = resolvePluginAndConfig(input.sourceType, input.sourceConfig, plugins);
  if (resolved == null) {
    throw new Error(`unsupported source_type: ${input.sourceType}`);
  }

  return resolved.kind === 'comp_token'
    ? resolved.plugin.buildBackfillRuntime(
        {
          daoSourceId: input.daoSourceId,
          sourceType: resolved.plugin.sourceType,
          chainId: input.chainId,
          sourceLabel: resolved.plugin.sourceType,
        },
        resolved.parsedConfig,
      )
    : resolved.plugin.buildBackfillRuntime(
        {
          daoSourceId: input.daoSourceId,
          sourceType: resolved.plugin.sourceType,
          chainId: input.chainId,
          sourceLabel: resolved.plugin.sourceType,
        },
        resolved.parsedConfig,
      );
}

type ResolvedPlugin =
  | {
      kind: 'governor';
      plugin: SourcePlugin<CompoundGovernorConfig>;
      parsedConfig: CompoundGovernorConfig;
    }
  | {
      kind: 'comp_token';
      plugin: SourcePlugin<CompTokenSourceConfig>;
      parsedConfig: CompTokenSourceConfig;
    };

function resolvePluginAndConfig(
  sourceType: SourceType,
  raw: unknown,
  plugins: readonly BackfillSourcePlugin[],
): ResolvedPlugin | null {
  for (const plugin of plugins) {
    if (plugin.sourceType === sourceType) {
      if (plugin.sourceType === 'compound_comp_token') {
        const compTokenPlugin = plugin as SourcePlugin<CompTokenSourceConfig>;
        return {
          kind: 'comp_token',
          plugin: compTokenPlugin,
          parsedConfig: compTokenPlugin.parseConfig(raw),
        };
      }
      const governorPlugin = plugin as SourcePlugin<CompoundGovernorConfig>;
      return {
        kind: 'governor',
        plugin: governorPlugin,
        parsedConfig: governorPlugin.parseConfig(raw),
      };
    }
  }
  return null;
}
