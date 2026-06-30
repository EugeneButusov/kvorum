import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { DecodedChoice } from '../domain/vote-choice-decoder';

export interface SnapshotVoteChoiceRow {
  voteId: string;
  choices: readonly DecodedChoice[];
  vp: string;
  vpByStrategy: unknown;
}

/** Writes/reads the Snapshot per-vote choice breakdown (ADR-072 D2). The API read-dispatch
 *  (findChoicesForVote) is AF1's; AD4 uses `findByVoteId` only in its own tests. */
export class SnapshotVoteChoiceRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async insert(row: SnapshotVoteChoiceRow): Promise<void> {
    await this.chDb
      .insertInto('snapshot_vote_choice')
      .values({
        vote_id: row.voteId,
        choices: JSON.stringify(row.choices),
        vp: row.vp,
        vp_by_strategy: JSON.stringify(row.vpByStrategy ?? null),
      })
      .execute();
  }

  async findByVoteId(voteId: string): Promise<readonly DecodedChoice[] | undefined> {
    // ReplacingMergeTree(version): pick the greatest version in JS (FINAL can't be placed by the
    // builder, and parts may be unmerged) — same approach as the archive round-trip.
    const rows = await this.chDb
      .selectFrom('snapshot_vote_choice')
      .select(['choices', 'version'])
      .where('vote_id', '=', voteId)
      .execute();
    if (rows.length === 0) return undefined;
    const latest = rows.reduce((a, b) => (b.version > a.version ? b : a));
    return JSON.parse(latest.choices) as DecodedChoice[];
  }

  async existsForVote(voteId: string): Promise<boolean> {
    const rows = await this.chDb
      .selectFrom('snapshot_vote_choice')
      .select('vote_id')
      .where('vote_id', '=', voteId)
      .limit(1)
      .execute();
    return rows.length > 0;
  }
}
