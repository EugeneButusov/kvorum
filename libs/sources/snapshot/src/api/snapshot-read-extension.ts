import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type {
  ChoiceBounds,
  CuratedDaoSourceConfig,
  DelegationModel,
  ProposalExtension,
  SourceReadExtension,
} from '@libs/domain';
import { asSourceConfigObject, curateEvmSourceConfig } from '@libs/domain';
import { SnapshotProposalExtensionReadRepository } from './snapshot-proposal-extension-read-repository';

// Read surface for the Snapshot source family: the off-chain `snapshot` proposal/vote source plus
// the two on-chain delegation source types.
const DELEGATION_SOURCE_TYPES = ['snapshot_delegate_registry', 'snapshot_split_delegation'];

export function makeSnapshotReadExtension(db: Kysely<PgDatabase>): SourceReadExtension {
  const repo = new SnapshotProposalExtensionReadRepository(db);
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
    getProposalExtension(
      proposalId: string,
      sourceType: string,
    ): Promise<ProposalExtension | null> {
      return sourceType === 'snapshot' ? repo.getExtension(proposalId) : Promise.resolve(null);
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
