import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { EasyTrackMotionState, NewEasyTrackMotionMeta } from '../../persistence/schema';

/**
 * Writes the `easy_track_motion_meta` ledger: one row per motion, keyed to its unified `proposal`.
 * `insert` is idempotent on the `proposal_id` PK (re-derivation is a no-op); `setState` advances the
 * motion-side lifecycle (`active → enacted | rejected | canceled`, or the non-terminal `objected`
 * annotation) independently of the unified `proposal.state`.
 */
export class EasyTrackMotionRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async insert(row: NewEasyTrackMotionMeta): Promise<void> {
    await this.db
      .insertInto('easy_track_motion_meta')
      .values(row)
      .onConflict((oc) => oc.column('proposal_id').doNothing())
      .execute();
  }

  async setState(proposalId: string, state: EasyTrackMotionState): Promise<void> {
    await this.db
      .updateTable('easy_track_motion_meta')
      .set({ state })
      .where('proposal_id', '=', proposalId)
      .execute();
  }

  /**
   * Mark a motion `objected` only while it is still `active`. Guarded so a late/out-of-order
   * `MotionObjected` cannot regress a motion that has already reached a terminal state.
   */
  async annotateObjected(proposalId: string): Promise<void> {
    await this.db
      .updateTable('easy_track_motion_meta')
      .set({ state: 'objected' })
      .where('proposal_id', '=', proposalId)
      .where('state', '=', 'active')
      .execute();
  }
}
