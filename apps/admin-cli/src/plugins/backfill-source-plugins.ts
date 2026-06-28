import type { Logger } from '@libs/chain';
import { ArchiveEventRepository, chDb, DlqRepository, pgDb, type SourceType } from '@libs/db';
import {
  AaveGovernorV2ArchiveWriter,
  AaveGovernorV2EventRepository,
  createAaveGovernorV2Plugin,
  AaveGovernanceArchiveWriter,
  AaveGovernanceEventRepository,
  createAaveGovernanceV3Plugin,
  AaveVotingMachineArchiveWriter,
  AaveVotingMachineEventRepository,
  createAaveVotingMachinePlugin,
  AavePayloadsControllerArchiveWriter,
  AavePayloadsControllerEventRepository,
  createAavePayloadsControllerPlugin,
  AaveTokenArchiveWriter,
  AaveTokenEventRepository,
  createAaveTokenPlugin,
  type AaveGovernorV2Config,
  type AaveGovernorV2PluginDeps,
  type AaveGovernanceV3Config,
  type AaveGovernanceV3PluginDeps,
  type AaveVotingMachineConfig,
  type AaveVotingMachinePluginDeps,
  type AavePayloadsControllerConfig,
  type AavePayloadsControllerPluginDeps,
  type AaveTokenConfig,
  type AaveTokenPluginDeps,
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
  | SourceIngester<AaveGovernorV2Config>
  | SourceIngester<AaveGovernanceV3Config>
  | SourceIngester<AaveVotingMachineConfig>
  | SourceIngester<AavePayloadsControllerConfig>
  | SourceIngester<AaveTokenConfig>;

export interface BackfillSourcePluginDeps {
  governor: CompoundGovernorPluginDeps;
  compToken: CompTokenPluginDeps;
  aaveGovernorV2: AaveGovernorV2PluginDeps;
  aaveGovernanceV3: AaveGovernanceV3PluginDeps;
  aaveVotingMachine: AaveVotingMachinePluginDeps;
  aavePayloadsController: AavePayloadsControllerPluginDeps;
  aaveToken: AaveTokenPluginDeps;
}

export function buildBackfillSourcePlugins(
  deps: BackfillSourcePluginDeps,
): readonly BackfillSourcePlugin[] {
  return [
    ...createCompoundPlugins(deps.governor),
    createCompTokenPlugin(deps.compToken),
    createAaveGovernorV2Plugin(deps.aaveGovernorV2),
    createAaveGovernanceV3Plugin(deps.aaveGovernanceV3),
    createAaveVotingMachinePlugin(deps.aaveVotingMachine),
    createAavePayloadsControllerPlugin(deps.aavePayloadsController),
    createAaveTokenPlugin(deps.aaveToken),
  ];
}

export function buildDefaultBackfillSourcePlugins(logger: Logger): readonly BackfillSourcePlugin[] {
  const dlqRepo = new DlqRepository(pgDb);

  const governorArchiveWriter = new GovernorArchiveWriter({
    eventRepo: new GovernorEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const compTokenArchiveWriter = new CompTokenArchiveWriter({
    eventRepo: new CompTokenEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const aaveGovernorV2ArchiveWriter = new AaveGovernorV2ArchiveWriter({
    eventRepo: new AaveGovernorV2EventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const aaveGovernanceV3ArchiveWriter = new AaveGovernanceArchiveWriter({
    eventRepo: new AaveGovernanceEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const aaveVotingMachineArchiveWriter = new AaveVotingMachineArchiveWriter({
    eventRepo: new AaveVotingMachineEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const aavePayloadsControllerArchiveWriter = new AavePayloadsControllerArchiveWriter({
    eventRepo: new AavePayloadsControllerEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const aaveTokenArchiveWriter = new AaveTokenArchiveWriter({
    eventRepo: new AaveTokenEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });

  return buildBackfillSourcePlugins({
    governor: { archiveWriter: governorArchiveWriter, dlqRepo, logger },
    compToken: { archiveWriter: compTokenArchiveWriter, dlqRepo, logger },
    aaveGovernorV2: { archiveWriter: aaveGovernorV2ArchiveWriter, dlqRepo, logger },
    aaveGovernanceV3: { archiveWriter: aaveGovernanceV3ArchiveWriter, dlqRepo, logger },
    aaveVotingMachine: { archiveWriter: aaveVotingMachineArchiveWriter, dlqRepo, logger },
    aavePayloadsController: { archiveWriter: aavePayloadsControllerArchiveWriter, dlqRepo, logger },
    aaveToken: { archiveWriter: aaveTokenArchiveWriter, dlqRepo, logger },
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

  if (resolved.plugin.buildBackfillRuntime == null) {
    throw new Error(`source_type "${input.sourceType}" is not backfillable`);
  }
  return resolved.plugin.buildBackfillRuntime(ctx, resolved.parsedConfig);
}

export interface ResolvedBackfillPlugin {
  plugin: SourceIngester<unknown>;
  parsedConfig: unknown;
}

/**
 * Resolves a source_type to its backfill plugin and parsed config. The per-source plugin
 * differences are entirely captured by `parseConfig`/`buildBackfillRuntime`, so this is a
 * generic lookup — no per-type discriminator is needed by any caller.
 */
export function resolvePluginAndConfig(
  sourceType: SourceType,
  raw: unknown,
  plugins: readonly BackfillSourcePlugin[],
): ResolvedBackfillPlugin | null {
  for (const plugin of plugins) {
    if (plugin.sourceType === sourceType) {
      const ingester = plugin as SourceIngester<unknown>;
      return { plugin: ingester, parsedConfig: ingester.parseConfig(raw) };
    }
  }
  return null;
}

/**
 * A source_type is EVM-backfillable iff its registered plugin provides a `buildBackfillRuntime` (not
 * inferred from a chain_id sentinel or a source_type suffix): EVM event-log sources have one; reconcile
 * sweeps and off-chain sources do not. The method's presence is the single source of truth for "include
 * in the EVM block-range backfill plan".
 */
export function isBackfillableSourceType(
  sourceType: string,
  plugins: readonly BackfillSourcePlugin[],
): boolean {
  return plugins.some(
    (plugin) => plugin.sourceType === sourceType && plugin.buildBackfillRuntime != null,
  );
}

/** Builds the `isBackfillable` predicate over the default backfill plugin registry. */
export function buildIsBackfillable(logger: Logger): (sourceType: string) => boolean {
  const plugins = buildDefaultBackfillSourcePlugins(logger);
  return (sourceType) => isBackfillableSourceType(sourceType, plugins);
}
