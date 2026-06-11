import type { Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveEventRepository,
  chDb,
  DlqRepository,
  pgDb,
  type SourceType,
} from '@libs/db';
import {
  CompTokenDelegationSnapshotRepository,
  CompoundCompTokenVotingPowerStrategy,
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
import type { BackfillRuntime, SourceIngester, SourceSnapshotStrategy } from '@sources/core';

export type BackfillSourcePlugin =
  | SourceIngester<CompoundGovernorConfig>
  | SourceIngester<CompTokenSourceConfig>;

export function buildBackfillSourcePlugins(deps: {
  governor: CompoundGovernorPluginDeps;
  compToken: CompTokenPluginDeps;
}): readonly BackfillSourcePlugin[] {
  return [...createCompoundPlugins(deps.governor), createCompTokenPlugin(deps.compToken)];
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
  const dlqRepo = new DlqRepository(pgDb);

  return buildBackfillSourcePlugins({
    governor: { archiveWriter: governorArchiveWriter, dlqRepo, logger },
    compToken: { archiveWriter: compTokenArchiveWriter, dlqRepo, logger },
  });
}

export function buildSnapshotStrategyMap(): Map<string, SourceSnapshotStrategy> {
  const strategy = new CompoundCompTokenVotingPowerStrategy(
    new CompTokenDelegationSnapshotRepository(chDb),
    new ActorRepository(pgDb),
  );
  const entry: SourceSnapshotStrategy = {
    sourceTypes: ['compound_governor_alpha', 'compound_governor_bravo', 'compound_governor_oz'],
    strategy,
  };
  return new Map<string, SourceSnapshotStrategy>([
    ['compound_governor_alpha', entry],
    ['compound_governor_bravo', entry],
    ['compound_governor_oz', entry],
  ]);
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
      plugin: SourceIngester<CompoundGovernorConfig>;
      parsedConfig: CompoundGovernorConfig;
    }
  | {
      kind: 'comp_token';
      plugin: SourceIngester<CompTokenSourceConfig>;
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
        const compTokenPlugin = plugin as SourceIngester<CompTokenSourceConfig>;
        return {
          kind: 'comp_token',
          plugin: compTokenPlugin,
          parsedConfig: compTokenPlugin.parseConfig(raw),
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
