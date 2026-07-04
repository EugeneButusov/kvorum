import type { SourceIngester } from '@sources/core';
import { createForumPlugin } from '@sources/forum';
import { createSnapshotPlugin } from '@sources/snapshot';
import { buildBackfillSourcePlugins } from './backfill-source-plugins.js';

// parseConfig is a pure Zod parse, independent of runtime deps (archive writers, DB/HTTP clients), so
// every plugin can be built with inert stubs solely to reach parseConfig. Mirrors the stub pattern the
// backfill plugin-coverage tests already use.
const stubDeps = () => ({
  archiveWriter: {} as never,
  dlqRepo: {} as never,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});

/**
 * Thrown when `daos source add/update` names a source_type that has no config-bearing ingester (a
 * reconcile sweep, or a genuinely unknown type). Distinguished from a Zod parse failure so the CLI can
 * report it as a validation error rather than silently accepting an unvalidated config.
 */
export class UnknownSourceTypeError extends Error {
  constructor(sourceType: string) {
    super(`source_type '${sourceType}' is not a recognized configurable source type`);
    this.name = 'UnknownSourceTypeError';
  }
}

/**
 * Every config-bearing ingester across all sources — EVM (via the backfill registry) **and** off-chain
 * (Snapshot GraphQL, Discourse) — built with stub deps purely to validate a source_config. This is
 * distinct from the backfill registry (EVM-only): source registration must validate off-chain configs
 * too, so this superset adds the two poll ingesters that have no EVM backfill runtime.
 */
export function buildAllIngesterPlugins(): readonly SourceIngester<unknown>[] {
  const evm = buildBackfillSourcePlugins({
    governor: stubDeps(),
    compToken: stubDeps(),
    aaveGovernorV2: stubDeps(),
    aaveGovernanceV3: stubDeps(),
    aaveVotingMachine: stubDeps(),
    aavePayloadsController: stubDeps(),
    aaveToken: stubDeps(),
    lidoAragonVoting: stubDeps(),
    lidoDualGovernance: stubDeps(),
    lidoEasyTrack: stubDeps(),
    snapshotDelegateRegistry: stubDeps(),
    snapshotSplitDelegation: stubDeps(),
  }) as readonly SourceIngester<unknown>[];

  const offChain: readonly SourceIngester<unknown>[] = [
    createSnapshotPlugin({ client: {} as never, chDb: {} as never }) as SourceIngester<unknown>,
    createForumPlugin({ chDb: {} as never }) as SourceIngester<unknown>,
  ];

  return [...evm, ...offChain];
}

/**
 * Validates a source_config for a given source_type by dispatching to that source's `parseConfig`.
 * Throws the plugin's Zod error on an invalid config, or `UnknownSourceTypeError` if the source_type
 * has no configurable ingester (closing the previous silent-skip hole that validated Compound only).
 */
export function validateSourceConfig(sourceType: string, config: unknown): void {
  const plugin = buildAllIngesterPlugins().find((p) => p.sourceType === sourceType);
  if (plugin == null) {
    throw new UnknownSourceTypeError(sourceType);
  }
  plugin.parseConfig(config);
}
