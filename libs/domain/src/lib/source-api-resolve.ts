import type {
  ChoiceBounds,
  DelegationModel,
  ProposalExtension,
  SourceApiContribution,
} from './source-api-contribution';

// DI token for the aggregated array of per-source API contributions. Lives in
// @libs/domain (not a @nest/* or @sources/* package) so apps/api may inject it
// while staying source-blind (eslint bans @sources/* imports under apps/api/src).
export const SOURCE_API_CONTRIBUTIONS = 'SOURCE_API_CONTRIBUTIONS';

// Defaults preserve the old SourceApiRegistry guarantee: unknown source types never
// 500 — they resolve to the widest choice bounds, the common delegation model, and a
// null proposal extension.
const DEFAULT_CHOICE_BOUNDS: ChoiceBounds = { min: 0, max: 2 };
const DEFAULT_DELEGATION_MODEL: DelegationModel = 'power-bearing';

export function resolveContribution(
  contributions: readonly SourceApiContribution[],
  sourceType: string,
): SourceApiContribution | undefined {
  return contributions.find((c) => c.sourceTypes.includes(sourceType));
}

export function choiceBoundsFor(
  contributions: readonly SourceApiContribution[],
  sourceType: string,
): ChoiceBounds {
  return (
    resolveContribution(contributions, sourceType)?.choiceBounds(sourceType) ??
    DEFAULT_CHOICE_BOUNDS
  );
}

export function delegationModelFor(
  contributions: readonly SourceApiContribution[],
  sourceType: string,
): DelegationModel {
  return (
    resolveContribution(contributions, sourceType)?.delegationModel(sourceType) ??
    DEFAULT_DELEGATION_MODEL
  );
}

export function getProposalExtensionFor(
  contributions: readonly SourceApiContribution[],
  proposalId: string,
  sourceType: string,
): Promise<ProposalExtension | null> {
  const contribution = resolveContribution(contributions, sourceType);
  if (contribution === undefined) return Promise.resolve(null);
  return contribution.getProposalExtension(proposalId, sourceType);
}
