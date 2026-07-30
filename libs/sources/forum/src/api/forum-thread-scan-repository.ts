import type { Kysely } from 'kysely';
import type { PgDatabase, ProposalState } from '@libs/db';
import '../persistence/schema';

/**
 * Reads the forum synthesizer's worklist (SPEC §5.7): forum threads that have `raw_content` and are
 * linked with `high`/`medium` confidence to a proposal in one of the given states (`pending`/`active`).
 *
 * Dedup against already-generated — or non-English-skipped — syntheses is deferred to the worker's
 * `sha256(raw_content)` cache-check, exactly like the summary/mismatch scan repos. So a thread stays
 * a candidate only until its *current* `raw_content` is processed; a new post rewrites `raw_content`,
 * changes the hash, and re-qualifies it (SPEC's refresh-on-new-posts).
 */
export class ForumThreadScanRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findCandidates(states: ProposalState[], limit: number): Promise<{ id: string }[]> {
    if (states.length === 0) return [];
    return this.db
      .selectFrom('forum_thread as ft')
      .select('ft.id')
      .where('ft.raw_content', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('proposal_forum_link as pfl')
            .innerJoin('proposal as p', 'p.id', 'pfl.proposal_id')
            .select('pfl.id')
            .whereRef('pfl.forum_thread_id', '=', 'ft.id')
            .where('pfl.confidence', 'in', ['high', 'medium'])
            .where('p.state', 'in', states),
        ),
      )
      .orderBy('ft.last_activity_at', 'desc')
      .limit(limit)
      .execute();
  }
}
