import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { ProposalExtension } from '@libs/domain';
import type { SnapshotProposalMetadataView } from './proposal-metadata-view';
import '../persistence/schema';

// Reads snapshot_proposal_metadata into ProposalExtension.metadata. Snapshot proposals carry
// no cross-chain `voting`/`payloads` surface (that is Aave-only), so those stay null/empty.
export class SnapshotProposalExtensionReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async getExtension(proposalId: string): Promise<ProposalExtension | null> {
    const row = await this.db
      .selectFrom('snapshot_proposal_metadata')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .executeTakeFirst();
    if (row === undefined) return null;

    const metadata: SnapshotProposalMetadataView = {
      kind: 'snapshot',
      space_id: row.space_id,
      voting_type: row.voting_type,
      strategies: row.strategies ?? null,
      ipfs_hash: row.ipfs_hash,
      network: row.network,
      scores_state: row.scores_state,
      flagged: row.flagged,
    };
    return { voting: null, payloads: [], metadata };
  }
}
