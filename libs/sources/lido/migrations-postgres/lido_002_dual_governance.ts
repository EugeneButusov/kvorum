import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value) VALUES ('dual_governance') ON CONFLICT DO NOTHING`.execute(
    db,
  );

  await sql`
    CREATE TYPE dual_governance_state AS ENUM (
      'normal',
      'veto_signaling',
      'veto_signaling_deactivation',
      'veto_cooldown',
      'rage_quit'
    )
  `.execute(db);

  await db.schema
    .createTable('dual_governance_state_history')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dao_id', 'uuid', (col) => col.notNull().references('dao.id').onDelete('restrict'))
    .addColumn('state', sql`dual_governance_state`, (col) => col.notNull())
    .addColumn('transition_at', 'timestamptz', (col) => col.notNull())
    .addColumn('block_number', 'bigint', (col) => col.notNull())
    .addColumn('tx_hash', 'text', (col) => col.notNull())
    .addColumn('rage_quit_eth_amount', 'numeric')
    .addColumn('veto_signaling_started_at', 'timestamptz')
    .addColumn('veto_signaling_deactivated_at', 'timestamptz')
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('idx_dual_governance_state_history_dao_transition')
    .on('dual_governance_state_history')
    .columns(['dao_id', 'transition_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_dual_governance_state_history_dao_transition').execute();
  await db.schema.dropTable('dual_governance_state_history').execute();
  await sql`DROP TYPE dual_governance_state`.execute(db);
  await sql`DELETE FROM source_type WHERE value = 'dual_governance'`.execute(db);
}
