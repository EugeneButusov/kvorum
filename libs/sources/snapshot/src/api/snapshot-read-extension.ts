import type { Kysely } from 'kysely';
import type { ClickHouseDatabase, PgDatabase } from '@libs/db';
import type {
  ChoiceBounds,
  CuratedDaoSourceConfig,
  DelegationModel,
  OffchainDelegationView,
  ProposalExtension,
  SourceReadExtension,
  VoteChoiceView,
} from '@libs/domain';
import { asSourceConfigObject, curateEvmSourceConfig } from '@libs/domain';
import type { SnapshotProposalMetadataView } from './proposal-metadata-view';
import { SnapshotDelegationReadRepository } from './snapshot-delegation-read-repository';
import { SnapshotProposalExtensionReadRepository } from './snapshot-proposal-extension-read-repository';
import { SnapshotVoteChoiceRepository } from '../persistence/snapshot-vote-choice-repository';

// Read surface for the Snapshot source family: the off-chain `snapshot` proposal/vote source plus
// the two on-chain delegation source types.
const DELEGATION_SOURCE_TYPES = ['snapshot_delegate_registry', 'snapshot_split_delegation'];

// Voting types whose tally the single `primary_choice` cannot represent — a voter spreads power over
// several choices — so their per-choice scores are computed from the full breakdown.
const SCORED_VOTING_TYPES = new Set(['approval', 'weighted', 'quadratic']);

export function makeSnapshotReadExtension(
  db: Kysely<PgDatabase>,
  chDb: Kysely<ClickHouseDatabase>,
): SourceReadExtension {
  const repo = new SnapshotProposalExtensionReadRepository(db);
  const voteChoiceRepo = new SnapshotVoteChoiceRepository(chDb);
  const delegationRepo = new SnapshotDelegationReadRepository(db);
  return {
    sourceTypes: ['snapshot', ...DELEGATION_SOURCE_TYPES],
    choiceBounds(_sourceType: string): ChoiceBounds {
      // Snapshot choices are 1..N and vary per proposal, so a single static bound can only widen to
      // avoid over-rejecting the primary_choice filter input (Int8 upper bound). Per-proposal bounds
      // are a follow-up (the filter-validation surface); primary_choice itself is always the
      // highest-weight choice (ADR-0072), so a permissive bound is safe here.
      return { min: 0, max: 127 };
    },
    delegationModel(sourceType: string): DelegationModel {
      // The on-chain delegation events carry no power figure (relationship only); the off-chain
      // `snapshot` source carries reported voting power on each vote.
      return DELEGATION_SOURCE_TYPES.includes(sourceType) ? 'relationship-only' : 'power-bearing';
    },
    async getProposalExtension(
      proposalId: string,
      sourceType: string,
    ): Promise<ProposalExtension | null> {
      if (sourceType !== 'snapshot') return null;
      const extension = await repo.getExtension(proposalId);
      if (extension?.metadata?.kind !== 'snapshot') return extension;
      const metadata = extension.metadata as SnapshotProposalMetadataView;
      // Approval/weighted/quadratic tallies aren't representable by the single primary_choice, so
      // compute the correct per-choice scores from the full breakdown (CH). Other types keep null:
      // single-choice/basic already tally from primary_choice, ranked/copeland need algorithmic scoring.
      if (SCORED_VOTING_TYPES.has(metadata.voting_type ?? '')) {
        metadata.choice_scores = await voteChoiceRepo.computeChoiceScores(proposalId);
      }
      return extension;
    },
    async getVoteChoices(voteId: string): Promise<readonly VoteChoiceView[] | null> {
      // Snapshot's per-vote breakdown (weighted/ranked/approval/etc.) lives in snapshot_vote_choice;
      // a missing row → null so the read layer synthesizes from primary_choice.
      return (await voteChoiceRepo.findByVoteId(voteId)) ?? null;
    },
    getActorOffchainDelegations(
      daoId: string,
      delegatorAddresses: readonly string[],
    ): Promise<readonly OffchainDelegationView[]> {
      return delegationRepo.findCurrentForActor(daoId, delegatorAddresses);
    },
    curateSourceConfig(sourceType: string, rawConfig: unknown): CuratedDaoSourceConfig {
      // The off-chain `snapshot` source binds by `space`; the delegation registries are on-chain.
      if (sourceType !== 'snapshot') return curateEvmSourceConfig(rawConfig);
      const cfg = asSourceConfigObject(rawConfig);
      const config: CuratedDaoSourceConfig = {};
      if (typeof cfg['space'] === 'string') config['space'] = cfg['space'];
      return config;
    },
  };
}
