import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { DualGovernanceState, NewDualGovernanceStateHistory } from '../../persistence/schema';

/**
 * Append-only DAO-wide Dual Governance state history (ADR-024). One row per persisted state
 * transition. Idempotency is structural: inserts conflict on the EVM event identity
 * (dao_id, block_number, tx_hash, log_index) and DO NOTHING (lido_002), so a backfill replay or a
 * re-derivation never duplicates a transition.
 */
export class DualGovernanceStateHistoryRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Append a transition. Returns whether a new row was written (false ⇒ already present). */
  async insert(row: NewDualGovernanceStateHistory): Promise<{ inserted: boolean }> {
    const result = await this.db
      .insertInto('dual_governance_state_history')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['dao_id', 'block_number', 'tx_hash', 'log_index']).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return { inserted: result !== undefined };
  }

  /** Current DG state for a DAO — a single indexed lookup (ADR-024). */
  async currentState(daoId: string): Promise<DualGovernanceState | undefined> {
    const row = await this.db
      .selectFrom('dual_governance_state_history')
      .select('state')
      .where('dao_id', '=', daoId)
      .orderBy('transition_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.state;
  }

  /** DG state at time T — the same indexed lookup bounded by transition_at (ADR-024). */
  async stateAt(daoId: string, at: Date): Promise<DualGovernanceState | undefined> {
    const row = await this.db
      .selectFrom('dual_governance_state_history')
      .select('state')
      .where('dao_id', '=', daoId)
      .where('transition_at', '<=', at)
      .orderBy('transition_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.state;
  }

  /**
   * All `rage_quit` transition timestamps for the DAO, ascending. The unified-state resolver checks
   * whether any falls within a proposal's pending window → ADR-031 `vetoed`. Rage quits are rare (none
   * on mainnet to date), so this read is bounded in practice; fetching them once per derivation lets the
   * overlap decision stay a pure, in-memory function.
   */
  async rageQuitTransitionsForDao(daoId: string): Promise<Date[]> {
    const rows = await this.db
      .selectFrom('dual_governance_state_history')
      .select('transition_at')
      .where('dao_id', '=', daoId)
      .where('state', '=', 'rage_quit')
      .orderBy('transition_at', 'asc')
      .execute();
    return rows.map((row) => row.transition_at);
  }
}
