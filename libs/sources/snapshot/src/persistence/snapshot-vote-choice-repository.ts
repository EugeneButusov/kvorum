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
 *  (findChoicesForVote) lives in the API read layer; `findByVoteId` is used by the derivation tests. */
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

  /**
   * Per-choice score for a proposal, summed from the full breakdown: score[i] = Σ over current
   * (non-superseded) votes of weight_i × vp. This is the correct tally for approval (each approved
   * choice gets weight 1.0 → full vp) and weighted/quadratic (fractional weights) voting, which the
   * single `primary_choice` in vote_events cannot represent. Returns null when the proposal has no
   * derived votes. The array is 0-indexed and dense up to the highest choice that received a vote.
   */
  async computeChoiceScores(proposalId: string): Promise<number[] | null> {
    const rows = await this.chDb
      .selectFrom('snapshot_vote_choice')
      .select(['vote_id', 'choices', 'vp', 'version'])
      .where('vote_id', 'in', (qb) =>
        qb
          .selectFrom('vote_events_projection')
          .select('vote_id')
          .where('proposal_id', '=', proposalId)
          .where('superseded', '=', 0),
      )
      .execute();
    if (rows.length === 0) return null;

    // ReplacingMergeTree: keep the greatest version per vote_id (parts may be unmerged). `version`
    // is a DateTime64 string; lexical comparison is chronological, as findByVoteId also relies on.
    const latest = new Map<string, { choices: string; vp: string; version: string }>();
    for (const r of rows) {
      const prev = latest.get(r.vote_id);
      if (prev === undefined || r.version > prev.version) latest.set(r.vote_id, r);
    }

    const scores: number[] = [];
    for (const { choices, vp } of latest.values()) {
      const vpNum = Number(vp);
      const parsed = JSON.parse(choices) as { choice_index: number; weight: string }[];
      for (const { choice_index, weight } of parsed) {
        scores[choice_index] = (scores[choice_index] ?? 0) + Number(weight) * vpNum;
      }
    }
    // Fill choice gaps with 0 and strip binary-float artifacts (e.g. 0.6 × 3 = 1.7999…998) so the
    // API surfaces the clean tally Snapshot itself shows; 12 significant figures preserves genuine
    // precision at any voting-power scale.
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      scores[i] = s === undefined ? 0 : Number(s.toPrecision(12));
    }
    return scores;
  }
}
