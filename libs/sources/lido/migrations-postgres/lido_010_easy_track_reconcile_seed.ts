import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Register the `easy_track_reconcile` ingester binding. The orchestrator schedules an
// evm-block-head-poller per dao_source row whose source_type has a registered ingester, so the
// reconcile pass needs its own dao_source row — mirroring lido_004 (`aragon_voting_reconcile`) and
// lido_008 (`dual_governance_reconcile`). It copies the base `easy_track` row's config (the reconciler
// reads `easy_track_address` from it for getMotions). The recheck watermark lives on
// `easy_track_motion_meta.last_reconcile_check_block` (lido_003), so nothing else is seeded here.
//
// Ordering: `easy_track` source_type (lido_003) + the `lido` dao + its `easy_track` dao_source
// (lido_009) all sort before this file, so the SELECT-copy resolves.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('easy_track_reconcile')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, 'easy_track_reconcile', chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'easy_track'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM dao_source WHERE source_type = 'easy_track_reconcile'`.execute(db);
  await sql`DELETE FROM source_type WHERE value = 'easy_track_reconcile'`.execute(db);
}
