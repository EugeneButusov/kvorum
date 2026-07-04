import type {
  ChoiceBounds,
  CuratedDaoSourceConfig,
  DelegationModel,
  OffchainDelegationView,
  OffchainDiscussionLinkView,
  ProposalExtension,
  SourceReadExtension,
  VoteChoiceView,
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

// Everything the proposal-detail read path needs: the source-specific extension (voting/payloads/
// metadata, or null when the source contributes none) plus the cross-source off-chain discussion
// links. Two dispatch shapes are combined here so the caller makes a single call: `extension` is
// resolved by the proposal's source_type; `offchainDiscussionLinks` is fanned out across all
// extensions (a proposal of any source may carry links, only the forum contribution implements it).
export interface ProposalExtensionResult {
  extension: ProposalExtension | null;
  offchainDiscussionLinks: readonly OffchainDiscussionLinkView[];
}

export async function getProposalExtensionFor(
  extensions: readonly SourceReadExtension[],
  proposalId: string,
  sourceType: string,
): Promise<ProposalExtensionResult> {
  const contribution = resolveReadExtension(extensions, sourceType);
  const [extension, linkBatches] = await Promise.all([
    contribution?.getProposalExtension(proposalId, sourceType) ?? Promise.resolve(null),
    Promise.all(extensions.map((e) => e.getOffchainDiscussionLinks?.(proposalId) ?? [])),
  ]);
  return { extension, offchainDiscussionLinks: linkBatches.flat() };
}

// The vote's multi-choice breakdown from its own source (resolved by source_type). Returns null when
// the source carries no per-vote breakdown, signalling the read layer to synthesize one from
// primary_choice — so no source-specific choice table leaks into the source-blind read repository.
export function getVoteChoicesFor(
  extensions: readonly SourceReadExtension[],
  voteId: string,
  sourceType: string,
): Promise<readonly VoteChoiceView[] | null> {
  const contribution = resolveReadExtension(extensions, sourceType);
  return contribution?.getVoteChoices?.(voteId) ?? Promise.resolve(null);
}

// An actor's current off-chain delegations within a DAO. Off-chain delegation doesn't fit the
// EVM-shaped /delegations list, so — like forum links — it fans out across all extensions (only the
// off-chain delegation source implements it) and concatenates.
export async function getActorOffchainDelegationsFor(
  extensions: readonly SourceReadExtension[],
  daoId: string,
  delegatorAddresses: readonly string[],
): Promise<OffchainDelegationView[]> {
  const batches = await Promise.all(
    extensions.map((e) => e.getActorOffchainDelegations?.(daoId, delegatorAddresses) ?? []),
  );
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
