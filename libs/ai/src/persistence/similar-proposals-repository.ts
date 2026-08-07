import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { PgDatabase, ProposalState, SourceType } from '@libs/db';
import { EMBEDDING_VERSION } from '../schemas/proposal-embedding-input.js';

export interface SimilarProposalFilters {
  /** Narrow to a single DAO by slug (default is cross-DAO). */
  dao?: string;
  /** Narrow to a proposal `source_type`. */
  type?: string;
  /** `created_at` range (inclusive). */
  from?: Date;
  to?: Date;
  limit: number;
}

export interface SimilarProposal {
  dao_slug: string;
  dao_name: string;
  source_type: SourceType;
  source_id: string;
  title: string | null;
  state: ProposalState;
  created_at: Date;
  voting_starts_at: Date | null;
  voting_ends_at: Date | null;
  /** Cosine similarity in [-1, 1] (1 = identical), i.e. `1 - cosine_distance`. */
  similarity: number;
}

/**
 * Cross-DAO "similar proposals" read (SPEC §5.8). Looks up the target proposal's current-version
 * embedding, then runs a pgvector cosine nearest-neighbour query over `proposal_embedding` joined to
 * `proposal`/`dao` for metadata — filtered to the current `EMBEDDING_VERSION`, excluding the target,
 * with optional DAO / type / time filters. Returns `[]` when the target has no current embedding
 * (unembedded or empty corpus) — the graceful-degrade contract.
 */
export class SimilarProposalsRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findSimilar(
    targetProposalId: string,
    filters: SimilarProposalFilters,
  ): Promise<SimilarProposal[]> {
    const target = await this.db
      .selectFrom('proposal_embedding')
      .select('embedding')
      .where('proposal_id', '=', targetProposalId)
      .where('embedding_version', '=', EMBEDDING_VERSION)
      .executeTakeFirst();
    if (target === undefined) return [];

    const targetVec = target.embedding; // pgvector text form '[...]'
    const distance = sql<number>`pe.embedding <=> ${targetVec}::vector`;

    let q = this.db
      .selectFrom('proposal_embedding as pe')
      .innerJoin('proposal as p', 'p.id', 'pe.proposal_id')
      .innerJoin('dao as d', 'd.id', 'p.dao_id')
      .select([
        'd.slug as dao_slug',
        'd.name as dao_name',
        'p.source_type',
        'p.source_id',
        'p.title',
        'p.state',
        'p.created_at',
        'p.voting_starts_at',
        'p.voting_ends_at',
        sql<number>`1 - (${distance})`.as('similarity'),
      ])
      .where('pe.embedding_version', '=', EMBEDDING_VERSION)
      .where('pe.proposal_id', '<>', targetProposalId);

    if (filters.dao !== undefined) q = q.where('d.slug', '=', filters.dao);
    if (filters.type !== undefined) q = q.where('p.source_type', '=', filters.type as SourceType);
    if (filters.from !== undefined) q = q.where('p.created_at', '>=', filters.from);
    if (filters.to !== undefined) q = q.where('p.created_at', '<=', filters.to);

    return q.orderBy(distance).limit(filters.limit).execute();
  }
}
