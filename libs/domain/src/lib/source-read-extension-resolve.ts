import type {
  ChoiceBounds,
  CuratedDaoSourceConfig,
  DelegationModel,
  ForumLinkView,
  ProposalExtension,
  SourceReadExtension,
} from './source-read-extension';

// DI token for the aggregated array of per-source API extensions. Lives in
// @libs/domain (not a @nest/* or @sources/* package) so apps/api may inject it
// while staying source-blind (eslint bans @sources/* imports under apps/api/src).
export const SOURCE_READ_EXTENSIONS = 'SOURCE_READ_EXTENSIONS';

// Defaults preserve the old SourceApiRegistry guarantee: unknown source types never
// 500 — they resolve to the widest choice bounds, the common delegation model, and a
// null proposal extension.
const DEFAULT_CHOICE_BOUNDS: ChoiceBounds = { min: 0, max: 2 };
const DEFAULT_DELEGATION_MODEL: DelegationModel = 'power-bearing';

export function resolveReadExtension(
  extensions: readonly SourceReadExtension[],
  sourceType: string,
): SourceReadExtension | undefined {
  return extensions.find((c) => c.sourceTypes.includes(sourceType));
}

export function choiceBoundsFor(
  extensions: readonly SourceReadExtension[],
  sourceType: string,
): ChoiceBounds {
  return (
    resolveReadExtension(extensions, sourceType)?.choiceBounds(sourceType) ?? DEFAULT_CHOICE_BOUNDS
  );
}

export function delegationModelFor(
  extensions: readonly SourceReadExtension[],
  sourceType: string,
): DelegationModel {
  return (
    resolveReadExtension(extensions, sourceType)?.delegationModel(sourceType) ??
    DEFAULT_DELEGATION_MODEL
  );
}

export function getProposalExtensionFor(
  extensions: readonly SourceReadExtension[],
  proposalId: string,
  sourceType: string,
): Promise<ProposalExtension | null> {
  const contribution = resolveReadExtension(extensions, sourceType);
  if (contribution === undefined) return Promise.resolve(null);
  return contribution.getProposalExtension(proposalId, sourceType);
}

// Forum links are cross-source (any proposal may carry them), so — unlike the source-type-keyed
// resolvers above — this fans out across all extensions and concatenates. Only the forum
// contribution implements getForumLinks today.
export async function getForumLinksFor(
  extensions: readonly SourceReadExtension[],
  proposalId: string,
): Promise<ForumLinkView[]> {
  const batches = await Promise.all(extensions.map((e) => e.getForumLinks?.(proposalId) ?? []));
  return batches.flat();
}

// Coerce a raw source_config into a plain object (helper for source curateSourceConfig impls).
export function asSourceConfigObject(rawConfig: unknown): Record<string, unknown> {
  return rawConfig !== null && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
    ? (rawConfig as Record<string, unknown>)
    : {};
}

// The on-chain default curation: contract_address (lowercased) + chain_id. Used for EVM sources and
// any source that does not override curateSourceConfig. Exported so on-chain source extensions can
// reuse it for their on-chain source types (e.g. Snapshot's delegation registries).
export function curateEvmSourceConfig(rawConfig: unknown): CuratedDaoSourceConfig {
  const cfg = asSourceConfigObject(rawConfig);
  const config: CuratedDaoSourceConfig = {};

  if (typeof cfg['contract_address'] === 'string') {
    config['contract_address'] = cfg['contract_address'].toLowerCase();
  }
  const rawChainId = cfg['chain_id'];
  if (typeof rawChainId === 'string') config['chain_id'] = rawChainId;
  else if (typeof rawChainId === 'number') config['chain_id'] = String(rawChainId);

  return config;
}

export function curateSourceConfigFor(
  extensions: readonly SourceReadExtension[],
  sourceType: string,
  rawConfig: unknown,
): CuratedDaoSourceConfig {
  const contribution = resolveReadExtension(extensions, sourceType);
  return (
    contribution?.curateSourceConfig?.(sourceType, rawConfig) ?? curateEvmSourceConfig(rawConfig)
  );
}
