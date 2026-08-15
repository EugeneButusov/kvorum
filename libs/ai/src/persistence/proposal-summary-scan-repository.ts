import type { Kysely } from 'kysely';
import type { PgDatabase, Proposal, ProposalState } from '@libs/db';

// Non-binding source types the summarizer still covers (Snapshot signaling). Snapshot is the only
// one today; add here when a second signaling source lands.
const SIGNALING_SOURCE_TYPES = ['snapshot'] as const;

/**
 * Reads the summarizer's proposal worklist. Lives in libs/ai (not the shared ProposalRepository)
 * because "which proposals get summarized" — binding on-chain proposals plus non-binding signaling
 * proposals — is an AI-feature policy, not common proposal logic. Template routing and the per-
 * proposal cache dedup happen in the worker; this is just the candidate scan.
 */
export class ProposalSummaryScanRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findCandidates(states: ProposalState[], limit: number): Promise<Proposal[]> {
    if (states.length === 0) return [];
    return this.db
      .selectFrom('proposal')
      .selectAll()
      .where('state', 'in', states)
      .where((eb) =>
        eb.or([eb('binding', '=', true), eb('source_type', 'in', [...SIGNALING_SOURCE_TYPES])]),
      )
      .orderBy('state_updated_at', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * The full-history backfill scan (M5-7.1): the same summarizer predicate (binding OR signaling) but
   * over **every** state — no lookback, no state filter — keyset-paginated on the PK `id` so a caller
   * can drain the whole historical corpus one page at a time, advancing `cursor` to the last id it saw
   * (regardless of cache-hits) and stopping when a page comes back empty. Optional `daoSlugs` scopes the
   * run to specific DAOs (empty/undefined ⇒ all). Unlike `findCandidates`, this is NOT a re-scan of a
   * bounded recent window — it is a stable total-order walk, so it never stalls on already-cached rows.
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
      .where((eb) =>
        eb.or([eb('p.binding', '=', true), eb('p.source_type', 'in', [...SIGNALING_SOURCE_TYPES])]),
      )
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
