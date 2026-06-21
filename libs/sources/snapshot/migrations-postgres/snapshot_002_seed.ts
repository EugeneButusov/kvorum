import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Snapshot source seed: cross-DAO `snapshot` dao_source rows (Lido + Aave + Compound).
//
// Migration ordering note: snapshot_* sorts AFTER snapshot_001 (which creates the `snapshot`
// source_type) and AFTER lido_004 (which creates the `lido` dao), so every FK referenced here
// already exists. Snapshot is off-chain: chain_id is the `off-chain` sentinel, source_config
// carries the space, and there is no active_from_block (off-chain has no blocks). AD1 reads
// source_config.space. Consumed by AD1 (no plugin yet) — tolerated at startup per ADR-0073.

const SNAPSHOT_SPACES: ReadonlyArray<{ slug: string; space: string }> = [
  { slug: 'lido', space: 'lido-snapshot.eth' },
  { slug: 'aave', space: 'aavedao.eth' },
  { slug: 'compound', space: 'comp-vote.eth' },
];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const { slug, space } of SNAPSHOT_SPACES) {
    await sql`
      INSERT INTO dao_source (dao_id, source_type, chain_id, source_config)
      SELECT id,
             'snapshot',
             'off-chain',
             ${sql.lit(JSON.stringify({ space }))}::jsonb
      FROM dao
      WHERE slug = ${slug}
      ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'snapshot'
      AND chain_id = 'off-chain'
      AND dao_id IN (SELECT id FROM dao WHERE slug IN ('lido', 'aave', 'compound'))
  `.execute(db);
}
