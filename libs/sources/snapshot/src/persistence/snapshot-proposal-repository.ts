import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewSnapshotProposalMetadata } from './schema';

export class SnapshotProposalRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Upsert per-proposal Snapshot metadata. DO UPDATE (not DO NOTHING) so an edit / reconcile
   *  finalization refreshes scores_state, voting_type, strategies, and flagged. `strategies` is
   *  JSON-stringified for the jsonb column — node-postgres otherwise serializes a JS array as a
   *  Postgres array literal, which jsonb rejects. */
  async upsertMetadata(row: NewSnapshotProposalMetadata): Promise<void> {
    const strategies = row.strategies == null ? null : (JSON.stringify(row.strategies) as unknown);
    const values = { ...row, strategies };
    await this.db
      .insertInto('snapshot_proposal_metadata')
      .values(values)
      .onConflict((oc) =>
        oc.column('proposal_id').doUpdateSet({
          space_id: row.space_id,
          voting_type: row.voting_type ?? null,
          strategies,
          ipfs_hash: row.ipfs_hash ?? null,
          network: row.network ?? null,
          scores_state: row.scores_state ?? null,
          flagged: row.flagged ?? false,
        }),
      )
      .execute();
  }

  /** Reconcile candidates for a space: closed proposals whose tally hasn't been observed `final`
   *  yet, within a bounded recency window (Snapshot finalizes in minutes–hours; stop re-querying
   *  never-finalizers). Returns the raw Snapshot proposal ids (proposal.source_id). */
  async findStaleClosedProposalIds(spaceId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('proposal as p')
      .innerJoin('snapshot_proposal_metadata as m', 'm.proposal_id', 'p.id')
      .select('p.source_id as source_id')
      .where('p.source_type', '=', 'snapshot')
      .where('m.space_id', '=', spaceId)
      .where((eb) =>
        eb.or([
          eb('m.scores_state', 'is', null),
          eb('m.scores_state', 'in', ['pending', 'active']),
        ]),
      )
      .where('p.voting_ends_at', 'is not', null)
      .where('p.voting_ends_at', '<', sql<Date>`now()`)
      .where('p.voting_ends_at', '>', sql<Date>`now() - interval '14 days'`)
      .orderBy('p.voting_ends_at', 'asc')
      .limit(limit)
      .execute();
    return rows.map((row) => row.source_id);
  }

  /** Vote-derivation inputs for a proposal: voting_type + network for the choice decode and the
   *  vote's voting_chain_id, and the choice count for index validation. */
  async findMetadata(
    proposalId: string,
  ): Promise<
    { voting_type: string | null; network: string | null; choice_count: number } | undefined
  > {
    const row = await this.db
      .selectFrom('snapshot_proposal_metadata')
      .select(['voting_type', 'network'])
      .where('proposal_id', '=', proposalId)
      .executeTakeFirst();
    if (row === undefined) return undefined;

    const count = await this.db
      .selectFrom('proposal_choice')
      .select(({ fn }) => fn.countAll().as('n'))
      .where('proposal_id', '=', proposalId)
      .executeTakeFirst();

    return {
      voting_type: row.voting_type,
      network: row.network,
      choice_count: Number(count?.n ?? 0),
    };
  }
}
