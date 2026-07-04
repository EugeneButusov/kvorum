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
import {
  createLidoAragonVotingPlugin,
  LidoAragonVotingArchiveWriter,
  AragonVotingEventRepository,
  createLidoDualGovernancePlugin,
  LidoDualGovernanceArchiveWriter,
  DualGovernanceEventRepository,
  createLidoEasyTrackPlugin,
  LidoEasyTrackArchiveWriter,
  EasyTrackEventRepository,
  type LidoAragonVotingConfig,
  type LidoAragonVotingPluginDeps,
  type LidoDualGovernanceConfig,
  type LidoDualGovernancePluginDeps,
  type LidoEasyTrackConfig,
  type LidoEasyTrackPluginDeps,
} from '@sources/lido';
import {
  createDelegateRegistryPlugin,
  DelegateRegistryArchiveWriter,
  DelegateRegistryEventRepository,
  createSplitDelegationPlugin,
  SplitDelegationArchiveWriter,
  SplitDelegationEventRepository,
  type DelegateRegistryConfig,
  type DelegateRegistryPluginDeps,
  type SplitDelegationConfig,
  type SplitDelegationPluginDeps,
} from '@sources/snapshot';

export type BackfillSourcePlugin =
  | SourceIngester<CompoundGovernorConfig>
  | SourceIngester<CompTokenSourceConfig>
  | SourceIngester<AaveGovernorV2Config>
  | SourceIngester<AaveGovernanceV3Config>
  | SourceIngester<AaveVotingMachineConfig>
  | SourceIngester<AavePayloadsControllerConfig>
  | SourceIngester<AaveTokenConfig>
  | SourceIngester<LidoAragonVotingConfig>
  | SourceIngester<LidoDualGovernanceConfig>
  | SourceIngester<LidoEasyTrackConfig>
  | SourceIngester<DelegateRegistryConfig>
  | SourceIngester<SplitDelegationConfig>;

export interface BackfillSourcePluginDeps {
  governor: CompoundGovernorPluginDeps;
  compToken: CompTokenPluginDeps;
  aaveGovernorV2: AaveGovernorV2PluginDeps;
  aaveGovernanceV3: AaveGovernanceV3PluginDeps;
  aaveVotingMachine: AaveVotingMachinePluginDeps;
  aavePayloadsController: AavePayloadsControllerPluginDeps;
  aaveToken: AaveTokenPluginDeps;
  lidoAragonVoting: LidoAragonVotingPluginDeps;
  lidoDualGovernance: LidoDualGovernancePluginDeps;
  lidoEasyTrack: LidoEasyTrackPluginDeps;
  snapshotDelegateRegistry: DelegateRegistryPluginDeps;
  snapshotSplitDelegation: SplitDelegationPluginDeps;
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
    createLidoAragonVotingPlugin(deps.lidoAragonVoting),
    createLidoDualGovernancePlugin(deps.lidoDualGovernance),
    createLidoEasyTrackPlugin(deps.lidoEasyTrack),
    createDelegateRegistryPlugin(deps.snapshotDelegateRegistry),
    createSplitDelegationPlugin(deps.snapshotSplitDelegation),
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
  const lidoAragonVotingArchiveWriter = new LidoAragonVotingArchiveWriter({
    eventRepo: new AragonVotingEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const lidoDualGovernanceArchiveWriter = new LidoDualGovernanceArchiveWriter({
    eventRepo: new DualGovernanceEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const lidoEasyTrackArchiveWriter = new LidoEasyTrackArchiveWriter({
    eventRepo: new EasyTrackEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const snapshotDelegateRegistryArchiveWriter = new DelegateRegistryArchiveWriter({
    eventRepo: new DelegateRegistryEventRepository({ chDb }),
    archiveEventRepo: new ArchiveEventRepository(pgDb),
    dlqRepo,
    logger,
  });
  const snapshotSplitDelegationArchiveWriter = new SplitDelegationArchiveWriter({
    eventRepo: new SplitDelegationEventRepository({ chDb }),
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
    lidoAragonVoting: { archiveWriter: lidoAragonVotingArchiveWriter, dlqRepo, logger },
    lidoDualGovernance: { archiveWriter: lidoDualGovernanceArchiveWriter, dlqRepo, logger },
    lidoEasyTrack: { archiveWriter: lidoEasyTrackArchiveWriter, dlqRepo, logger },
    snapshotDelegateRegistry: {
      archiveWriter: snapshotDelegateRegistryArchiveWriter,
      dlqRepo,
      logger,
    },
    snapshotSplitDelegation: {
      archiveWriter: snapshotSplitDelegationArchiveWriter,
      dlqRepo,
      logger,
    },
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
