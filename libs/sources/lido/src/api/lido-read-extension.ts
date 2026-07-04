import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { ChoiceBounds, DelegationModel, SourceReadExtension } from '@libs/domain';
import { LidoProposalExtensionReadRepository } from './lido-proposal-extension-read-repository';

// Read surface for the three Lido on-chain tracks: Aragon binding voting, Dual Governance, and
// Easy Track. Each proposal's source_type selects the metadata table read in the repository.
export function makeLidoReadExtension(db: Kysely<PgDatabase>): SourceReadExtension {
  const repo = new LidoProposalExtensionReadRepository(db);
  return {
    sourceTypes: ['aragon_voting', 'dual_governance', 'easy_track'],
    choiceBounds(_sourceType: string): ChoiceBounds {
      // Aragon binding votes are yea/nay (0..1). DG and Easy Track are proposal-state tracks with no
      // per-voter choice, so the bound is unused for them.
      return { min: 0, max: 1 };
    },
    delegationModel(_sourceType: string): DelegationModel {
      return 'relationship-only';
    },
    getProposalExtension(proposalId, sourceType) {
      return repo.getExtension(proposalId, sourceType);
    },
  };
}
