import type {
  ChoiceBounds,
  DelegationModel,
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
