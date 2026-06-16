import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { SourceApiContribution } from '@libs/domain';
import { AaveProposalExtensionReadRepository } from '../persistence/aave-proposal-extension-read-repository';

export function makeAaveApiContribution(db: Kysely<PgDatabase>): SourceApiContribution {
  const repo = new AaveProposalExtensionReadRepository(db);
  return {
    sourceTypes: [
      'aave_governance_v3',
      'aave_governor_v2',
      'aave_voting_machine',
      'aave_payloads_controller',
    ],
    choiceBounds(_sourceType) {
      return { min: 0, max: 1 };
    },
    getProposalExtension(proposalId, _sourceType) {
      return repo.getExtension(proposalId);
    },
  };
}
