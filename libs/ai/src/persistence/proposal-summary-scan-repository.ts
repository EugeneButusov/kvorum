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
}
