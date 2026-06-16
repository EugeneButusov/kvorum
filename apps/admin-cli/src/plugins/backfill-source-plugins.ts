import type { Logger } from '@libs/chain';
import { ArchiveEventRepository, chDb, DlqRepository, pgDb, type SourceType } from '@libs/db';
import {
  AaveGovernorV2ArchiveWriter,
  AaveGovernorV2EventRepository,
  createAaveGovernorV2Plugin,
  type AaveGovernorV2Config,
  type AaveGovernorV2PluginDeps,
} from '@sources/aave';
import {
  GovernorArchiveWriter,
  CompTokenArchiveWriter,
  CompTokenEventRepository,
  createCompTokenPlugin,
  GovernorEventRepository,
  createCompoundPlugins,
  type CompoundGovernorConfig,
  type CompoundGovernorPluginDeps,
  type CompTokenPluginDeps,
  type CompTokenSourceConfig,
} from '@sources/compound';
import type { BackfillRuntime, SourceIngester } from '@sources/core';

export type BackfillSourcePlugin =
  | SourceIngester<CompoundGovernorConfig>
  | SourceIngester<CompTokenSourceConfig>
  | SourceIngester<AaveGovernorV2Config>;

export function buildBackfillSourcePlugins(deps: {
  governor: CompoundGovernorPluginDeps;
  compToken: CompTokenPluginDeps;
  aaveGovernorV2: AaveGovernorV2PluginDeps;
}): readonly BackfillSourcePlugin[] {
  return [
    ...createCompoundPlugins(deps.governor),
    createCompTokenPlugin(deps.compToken),
    createAaveGovernorV2Plugin(deps.aaveGovernorV2),
  ];
}

export function buildDefaultBackfillSourcePlugins(logger: Logger): readonly BackfillSourcePlugin[] {
  const governorArchiveWriter = new GovernorArchiveWriter({
    eventRepo: new GovernorEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo: new DlqRepository(pgDb),
    logger,
  });
  const compTokenArchiveWriter = new CompTokenArchiveWriter({
    eventRepo: new CompTokenEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo: new DlqRepository(pgDb),
    logger,
  });
  const aaveGovernorV2ArchiveWriter = new AaveGovernorV2ArchiveWriter({
    eventRepo: new AaveGovernorV2EventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo: new DlqRepository(pgDb),
    logger,
  });
  const dlqRepo = new DlqRepository(pgDb);

  return buildBackfillSourcePlugins({
    governor: { archiveWriter: governorArchiveWriter, dlqRepo, logger },
    compToken: { archiveWriter: compTokenArchiveWriter, dlqRepo, logger },
    aaveGovernorV2: { archiveWriter: aaveGovernorV2ArchiveWriter, dlqRepo, logger },
  });
}

export interface BackfillSourceRuntimeInput {
  daoSourceId: string;
  sourceType: SourceType;
  sourceConfig: unknown;
  chainId: string;
  logger: Logger;
}

export function buildBackfillSourceRuntime(input: BackfillSourceRuntimeInput): BackfillRuntime {
  const plugins = buildDefaultBackfillSourcePlugins(input.logger);
  const resolved = resolvePluginAndConfig(input.sourceType, input.sourceConfig, plugins);
  if (resolved == null) {
    throw new Error(`unsupported source_type: ${input.sourceType}`);
  }

  const ctx = {
    daoSourceId: input.daoSourceId,
    sourceType: resolved.plugin.sourceType,
    chainId: input.chainId,
    sourceLabel: resolved.plugin.sourceType,
  };

  return (resolved.plugin as SourceIngester<unknown>).buildBackfillRuntime(
    ctx,
    resolved.parsedConfig,
  );
}

type ResolvedPlugin =
  | {
      kind: 'governor';
      plugin: SourceIngester<CompoundGovernorConfig>;
      parsedConfig: CompoundGovernorConfig;
    }
  | {
      kind: 'comp_token';
      plugin: SourceIngester<CompTokenSourceConfig>;
      parsedConfig: CompTokenSourceConfig;
    }
  | {
      kind: 'aave_governor_v2';
      plugin: SourceIngester<AaveGovernorV2Config>;
      parsedConfig: AaveGovernorV2Config;
    };

export function resolvePluginAndConfig(
  sourceType: SourceType,
  raw: unknown,
  plugins: readonly BackfillSourcePlugin[],
): ResolvedPlugin | null {
  for (const plugin of plugins) {
    if (plugin.sourceType === sourceType) {
      if (plugin.sourceType === 'compound_comp_token') {
        const compTokenPlugin = plugin as SourceIngester<CompTokenSourceConfig>;
        return {
          kind: 'comp_token',
          plugin: compTokenPlugin,
          parsedConfig: compTokenPlugin.parseConfig(raw),
        };
      }
      if (plugin.sourceType === 'aave_governor_v2') {
        const aavePlugin = plugin as SourceIngester<AaveGovernorV2Config>;
        return {
          kind: 'aave_governor_v2',
          plugin: aavePlugin,
          parsedConfig: aavePlugin.parseConfig(raw),
        };
      }
      const governorPlugin = plugin as SourceIngester<CompoundGovernorConfig>;
      return {
        kind: 'governor',
        plugin: governorPlugin,
        parsedConfig: governorPlugin.parseConfig(raw),
      };
    }
  }
  return null;
}
