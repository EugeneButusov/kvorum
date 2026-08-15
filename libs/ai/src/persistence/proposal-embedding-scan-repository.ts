import type { Kysely } from 'kysely';
import type { PgDatabase, Proposal } from '@libs/db';

/**
 * The embedding backfill worklist (SPEC §5.8, M5-7.1). Every proposal above `pending` is embedded
 * (matching the trigger scanner's `EMBED_STATES`), so the backfill covers `state <> 'pending'`. Lives
 * in libs/ai (not the shared ProposalRepository) because "which proposals get embedded" is an AI-feature
 * policy — mirroring the summary/mismatch scan repos. There is no steady-state embedding *scan* today
 * (the trigger scanner reads `ProposalRepository.findRecentlyTransitioned`); this repo exists only for
 * the full-history backfill, so it has a single `findAllForBackfill` method.
 */
export class ProposalEmbeddingScanRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /**
   * Keyset-paginated on the PK `id` over every proposal above `pending`; advance `cursor` to the last
   * id seen and stop on an empty page. Optional `daoSlugs` scopes to specific DAOs (empty/undefined ⇒
   * all). The handler's `(proposal_id, embedding_version)` cache makes re-runs idempotent.
   */
  async findAllForBackfill(
    cursor: string | null,
    pageSize: number,
    daoSlugs?: string[],
  ): Promise<Proposal[]> {
    const scopeDaos = daoSlugs !== undefined && daoSlugs.length > 0;
    return this.db
      .selectFrom('proposal as p')
      .selectAll('p')
      .where('p.state', '<>', 'pending')
      .$if(cursor !== null, (qb) => qb.where('p.id', '>', cursor as string))
      .$if(scopeDaos, (qb) =>
        qb.where('p.dao_id', 'in', (eb) =>
          eb
            .selectFrom('dao')
            .select('dao.id')
            .where('dao.slug', 'in', daoSlugs as string[]),
        ),
      )
      .orderBy('p.id', 'asc')
      .limit(pageSize)
      .execute();
  }
}
