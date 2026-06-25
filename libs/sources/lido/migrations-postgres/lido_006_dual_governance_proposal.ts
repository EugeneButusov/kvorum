import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// AB3 (#330): the Dual Governance proposal-flow ledger. One row per Timelock proposal submission,
// recording the DG/Timelock proposalId, its correlation to the originating Aragon vote (or `direct`
// when none exists), and the DG timelock sub-lifecycle (submitted → scheduled → executed | cancelled).
// The canonical unified `proposal` row is the Aragon one for correlated submissions, or this DG
// submission's own `proposal` (source_type='dual_governance') for direct ones; `proposal.state` tracks
// `f(status)` (ADR-0074 §4). Idempotent under replay via the unique (dao_id, dg_proposal_id) index.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE dual_governance_proposal_origin AS ENUM ('aragon', 'direct')`.execute(db);

  await sql`
    CREATE TYPE dual_governance_proposal_status AS ENUM (
      'submitted',
      'scheduled',
      'executed',
      'cancelled'
    )
  `.execute(db);

  await db.schema
    .createTable('dual_governance_proposal')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dao_id', 'uuid', (col) => col.notNull().references('dao.id').onDelete('restrict'))
    // EmergencyProtectedTimelock proposalId — a sequential counter (1, 2, …), not a hash.
    .addColumn('dg_proposal_id', 'bigint', (col) => col.notNull())
    // The canonical unified proposal: the Aragon vote's row (origin='aragon') or this DG submission's
    // own row (origin='direct').
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('restrict'),
    )
    .addColumn('origin', sql`dual_governance_proposal_origin`, (col) => col.notNull())
    // Aragon voteId when origin='aragon' (provenance; the link is the shared enactment tx, ADR-0074 §4).
    .addColumn('aragon_source_id', 'text')
    .addColumn('executor', 'text', (col) => col.notNull())
    // keccak of the normalized inner calls — heuristic-fallback + audit anchor.
    .addColumn('calls_hash', 'text', (col) => col.notNull())
    .addColumn('submitted_tx_hash', 'text', (col) => col.notNull())
    .addColumn('submitted_block', 'bigint', (col) => col.notNull())
    .addColumn('submitted_at', 'timestamptz', (col) => col.notNull())
    .addColumn('status', sql`dual_governance_proposal_status`, (col) =>
      col.notNull().defaultTo('submitted'),
    )
    .addColumn('scheduled_at', 'timestamptz')
    .addColumn('executed_at', 'timestamptz')
    .addColumn('cancelled_at', 'timestamptz')
    // AB4 reconciler watermark (left NULL by AB3).
    .addColumn('last_reconcile_check_block', 'bigint')
    .execute();

  // Idempotency anchor: one ledger row per DG submission. (dao_id scopes the chain for this
  // mainnet-only source.)
  await db.schema
    .createIndex('uq_dual_governance_proposal_dg_id')
    .unique()
    .on('dual_governance_proposal')
    .columns(['dao_id', 'dg_proposal_id'])
    .execute();

  // Correlation + lifecycle reads go through the canonical proposal.
  await db.schema
    .createIndex('idx_dual_governance_proposal_proposal')
    .on('dual_governance_proposal')
    .column('proposal_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_dual_governance_proposal_proposal').execute();
  await db.schema.dropIndex('uq_dual_governance_proposal_dg_id').execute();
  await db.schema.dropTable('dual_governance_proposal').execute();
  await sql`DROP TYPE dual_governance_proposal_status`.execute(db);
  await sql`DROP TYPE dual_governance_proposal_origin`.execute(db);
}
