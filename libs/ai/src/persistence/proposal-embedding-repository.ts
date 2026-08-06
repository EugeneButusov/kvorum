import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewProposalEmbedding, ProposalEmbedding } from './schema.js';

export class ProposalEmbeddingRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** The cache-check: the current-version embedding row for a proposal, if any (compare its
   *  `input_hash` to decide hit vs. re-embed). `executor` lets this join a caller's transaction. */
  async findByProposalVersion(
    proposalId: string,
    embeddingVersion: string,
    executor: Kysely<PgDatabase> = this.db,
  ): Promise<ProposalEmbedding | undefined> {
    return executor
      .selectFrom('proposal_embedding')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .where('embedding_version', '=', embeddingVersion)
      .executeTakeFirst();
  }

  /**
   * Upsert one embedding on the `(proposal_id, embedding_version)` unique key: a re-embed after the
   * composed input changed OVERWRITES the vector in place (one current vector per proposal per
   * version) — `doNothing` would strand a stale vector. `executor` lets this join a transaction.
   */
  async upsert(row: NewProposalEmbedding, executor: Kysely<PgDatabase> = this.db): Promise<void> {
    await executor
      .insertInto('proposal_embedding')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['proposal_id', 'embedding_version']).doUpdateSet({
          input_hash: row.input_hash,
          embedding: row.embedding,
          generated_at: row.generated_at,
          cost_usd: row.cost_usd,
        }),
      )
      .execute();
  }
}
