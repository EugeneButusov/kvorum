import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { DualGovernanceProposal, NewDualGovernanceProposal } from '../../persistence/schema';

/**
 * The Dual Governance proposal-flow ledger (ADR-0074 §4). One row per Timelock submission, keyed on
 * the EVM-native `(dao_id, dg_proposal_id)`, recording correlation (origin + canonical proposal) and
 * the DG timelock sub-lifecycle (submitted → scheduled → executed | cancelled). Every mutation is
 * idempotent so backfill replay / re-derivation never double-writes.
 */
export class DualGovernanceProposalRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Create the ledger row for a submission. Idempotent: a replay returns the existing row unchanged. */
  async upsertSubmission(
    row: NewDualGovernanceProposal,
  ): Promise<{ inserted: boolean; row: DualGovernanceProposal }> {
    const inserted = await this.db
      .insertInto('dual_governance_proposal')
      .values(row)
      .onConflict((oc) => oc.columns(['dao_id', 'dg_proposal_id']).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted !== undefined) return { inserted: true, row: inserted };

    const existing = await this.findByDgId(row.dao_id, row.dg_proposal_id);
    // The conflict implies a row exists; the non-null assertion is the only way to express that to TS.
    return { inserted: false, row: existing! };
  }

  async findByDgId(
    daoId: string,
    dgProposalId: string,
  ): Promise<DualGovernanceProposal | undefined> {
    return this.db
      .selectFrom('dual_governance_proposal')
      .selectAll()
      .where('dao_id', '=', daoId)
      .where('dg_proposal_id', '=', dgProposalId)
      .executeTakeFirst();
  }

  /**
   * Ledger rows whose unified state can still flip to `vetoed` — every non-`executed` row for the DAO
   * (an executed proposal is `executed` regardless of a rage-quit). The rage-quit step re-resolves
   * these so a covered pending proposal becomes `vetoed` (ADR-031). Includes `cancelled` rows: a
   * bulk-cancel inside a rage-quit window resolves to `vetoed`, not `canceled`.
   */
  async findResolvableByDao(daoId: string): Promise<DualGovernanceProposal[]> {
    return this.db
      .selectFrom('dual_governance_proposal')
      .selectAll()
      .where('dao_id', '=', daoId)
      .where('status', '<>', 'executed')
      .execute();
  }

  /** Advance status to `scheduled` (only from `submitted`); returns the current row. */
  async markScheduled(
    daoId: string,
    dgProposalId: string,
    at: Date,
  ): Promise<DualGovernanceProposal | undefined> {
    await this.db
      .updateTable('dual_governance_proposal')
      .set({ status: 'scheduled', scheduled_at: at })
      .where('dao_id', '=', daoId)
      .where('dg_proposal_id', '=', dgProposalId)
      .where('status', '=', 'submitted')
      .execute();
    return this.findByDgId(daoId, dgProposalId);
  }

  /** Advance status to `executed` (from `submitted`/`scheduled`); returns the current row. */
  async markExecuted(
    daoId: string,
    dgProposalId: string,
    at: Date,
  ): Promise<DualGovernanceProposal | undefined> {
    await this.db
      .updateTable('dual_governance_proposal')
      .set({ status: 'executed', executed_at: at })
      .where('dao_id', '=', daoId)
      .where('dg_proposal_id', '=', dgProposalId)
      .where('status', 'in', ['submitted', 'scheduled'])
      .execute();
    return this.findByDgId(daoId, dgProposalId);
  }

  /**
   * Bulk-cancel range (`cancelAllPendingProposals` → `ProposalsCancelledTill(boundary)`): cancels every
   * non-terminal ledger row with `dg_proposal_id <= boundary`. Returns the rows newly cancelled by this
   * call so the caller can flip their canonical proposals to `canceled`. Idempotent — an already
   * `cancelled`/`executed` row is untouched and not returned.
   */
  async cancelThrough(
    daoId: string,
    boundaryDgProposalId: string,
    at: Date,
  ): Promise<DualGovernanceProposal[]> {
    return this.db
      .updateTable('dual_governance_proposal')
      .set({ status: 'cancelled', cancelled_at: at })
      .where('dao_id', '=', daoId)
      .where('dg_proposal_id', '<=', boundaryDgProposalId)
      .where('status', 'not in', ['executed', 'cancelled'])
      .returningAll()
      .execute();
  }
}
