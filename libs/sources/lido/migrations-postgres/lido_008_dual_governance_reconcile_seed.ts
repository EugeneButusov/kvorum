import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Register the `dual_governance_reconcile` ingester binding. The indexer orchestrator
// schedules an evm-block-head-poller per dao_source row whose source_type has a registered ingester
// (apps/indexer SourceResolver / orchestrator iterate dao_source.findAll()), so the reconcile pass
// needs its own dao_source row — mirroring lido_004's `aragon_voting_reconcile` binding. It copies the
// base `dual_governance` row's config (the reconciler reads dual_governance_address + timelock_address
// from it for getStateDetails / isEmergencyModeActive). The cursor table is lido_007; rows there are
// upserted lazily by the reconciler, so nothing is seeded here beyond the binding.
//
// Ordering: `dual_governance` source_type (lido_002) + the `lido` dao + its `dual_governance` dao_source
// (lido_004 / lido_005) all sort before this file, so the SELECT-copy resolves.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('dual_governance_reconcile')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, 'dual_governance_reconcile', chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'dual_governance'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM dao_source WHERE source_type = 'dual_governance_reconcile'`.execute(db);
  await sql`DELETE FROM source_type WHERE value = 'dual_governance_reconcile'`.execute(db);
}
