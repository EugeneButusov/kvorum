import type { Kysely } from 'kysely';
import type { PgDatabase, Proposal, ProposalState } from '@libs/db';

/**
 * Reads the mismatch detector's proposal worklist (SPEC §5.6). Lives in libs/ai (not the shared
 * ProposalRepository) because "which proposals get a mismatch analysis" is an AI-feature policy.
 * A proposal qualifies when it is **binding**, in one of the given states, has at least one
 * `proposal_action`, and **every** action is `decode_status = 'decoded'` (strict — an `undecodable`
 * action blocks the run, matching SPEC's "all successfully decoded"). Snapshot proposals are
 * excluded implicitly (they are non-binding). Template rendering and the per-proposal cache dedup
 * happen in the worker; this is just the candidate scan.
 */
export class ProposalMismatchScanRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findCandidates(states: ProposalState[], limit: number): Promise<Proposal[]> {
    if (states.length === 0) return [];
    return (
      this.db
        .selectFrom('proposal as p')
        .selectAll('p')
        .where('p.binding', '=', true)
        .where('p.state', 'in', states)
        // has calldata to compare against (at least one action)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('proposal_action as a')
              .select('a.id')
              .whereRef('a.proposal_id', '=', 'p.id'),
          ),
        )
        // and none of them is still un-decoded (strict: every action is 'decoded')
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('proposal_action as u')
                .select('u.id')
                .whereRef('u.proposal_id', '=', 'p.id')
                .where('u.decode_status', '<>', 'decoded'),
            ),
          ),
        )
        .orderBy('p.state_updated_at', 'asc')
        .limit(limit)
        .execute()
    );
  }

  /**
   * The full-history backfill scan (M5-7.1): the exact mismatch predicate — binding, has calldata,
   * every action `decoded` — but over **every** state (no state filter, no lookback, no cap),
   * keyset-paginated on the PK `id`. Advance `cursor` to the last id seen; stop on an empty page.
   * Optional `daoSlugs` scopes to specific DAOs (empty/undefined ⇒ all). Terminal binding proposals
   * (`succeeded`/`executed`/…) — which the active-only `findCandidates` can never reach — are covered
   * here.
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
      .where('p.binding', '=', true)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('proposal_action as a')
            .select('a.id')
            .whereRef('a.proposal_id', '=', 'p.id'),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('proposal_action as u')
              .select('u.id')
              .whereRef('u.proposal_id', '=', 'p.id')
              .where('u.decode_status', '<>', 'decoded'),
          ),
        ),
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
