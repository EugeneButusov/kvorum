import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewAaveProposalMetadata, NewAaveProposalPayload } from './schema';

export class AaveProposalRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async insertMetadata(row: NewAaveProposalMetadata): Promise<void> {
    await this.db
      .insertInto('aave_proposal_metadata')
      .values(row)
      .onConflict((oc) => oc.column('proposal_id').doNothing())
      .execute();
  }

  async setSnapshotBlockHash(proposalId: string, snapshotBlockHash: string): Promise<void> {
    await this.db
      .updateTable('aave_proposal_metadata')
      .set({ snapshot_block_hash: snapshotBlockHash })
      .where('proposal_id', '=', proposalId)
      .execute();
  }

  async insertDeclaredPayload(row: NewAaveProposalPayload): Promise<void> {
    await this.db
      .insertInto('aave_proposal_payload')
      .values(row)
      .onConflict((oc) => oc.columns(['proposal_id', 'payload_index']).doNothing())
      .execute();
  }
}
