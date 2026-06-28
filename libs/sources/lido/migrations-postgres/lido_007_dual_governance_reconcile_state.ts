import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Per-DAO reconcile cursor for the `dual_governance_reconcile` ingester. The DG state
// machine is reconciled DAO-wide (ADR-024), so the candidate is one row per DG DAO — unlike the
// per-proposal reconcilers (Aragon/Aave/Compound) which hang their watermark on a proposal-metadata
// table. `last_reconcile_check_block` bounds the getStateDetails re-read cadence; `last_effective_state`
// records the most recent observed effective state for drift surfacing (ADR-0074 §2). Rows are upserted
// lazily by the reconciler on first observation — there is no seed row, so the candidate query LEFT
// JOINs and treats a missing row as "never checked".
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dual_governance_reconcile_state')
    .addColumn('dao_id', 'uuid', (col) =>
      col.primaryKey().references('dao.id').onDelete('restrict'),
    )
    .addColumn('last_reconcile_check_block', 'bigint')
    .addColumn('last_effective_state', sql`dual_governance_state`)
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dual_governance_reconcile_state').execute();
}
