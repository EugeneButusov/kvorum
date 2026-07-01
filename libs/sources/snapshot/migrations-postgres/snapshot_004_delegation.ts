import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// snapshot_delegation: append-only event-sourced facts from Snapshot's on-chain delegation
// systems (Gnosis Delegate Registry + Split Delegation). Distinct from delegation_flow_*
// (token-power delegation in CH); this is space- and network-scoped signaling delegation. Current
// delegation + space-over-global precedence are resolved at read time. See ADR-0075.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('snapshot_delegation')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // null = global (Delegate Registry id == 0x0, applies to every space); else the dao bound to the space.
    .addColumn('dao_id', 'uuid', (col) => col.references('dao.id').onDelete('cascade'))
    .addColumn('delegator_address', 'text', (col) => col.notNull())
    // ZERO address on a clear (the unique key needs a non-null value).
    .addColumn('delegate_address', 'text', (col) => col.notNull())
    // null = global scope.
    .addColumn('space_id', 'text')
    // Canonical chain_id of the registry (SPEC "network"); hex, e.g. '0x1'.
    .addColumn('network', 'text', (col) => col.notNull())
    // 'delegate_registry' | 'split_delegation'.
    .addColumn('delegation_system', 'text', (col) => col.notNull())
    // Split Delegation normalized ratio fraction; null = full delegation (Delegate Registry).
    .addColumn('weight', 'numeric')
    // Split Delegation expiration; null = none.
    .addColumn('expires_at', 'timestamptz')
    // 'set' | 'clear'.
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('block_number', 'bigint', (col) => col.notNull())
    .addColumn('log_index', 'integer', (col) => col.notNull())
    .addColumn('tx_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    // Idempotency: one row per (network, tx, log, delegate). A clear's ZERO sentinel is non-null,
    // so a re-derived clear collides and is dropped by ON CONFLICT.
    .addUniqueConstraint('snapshot_delegation_event_unique', [
      'network',
      'tx_hash',
      'log_index',
      'delegate_address',
    ])
    .execute();

  // Current-delegation lookups: per delegator within a (space | global) scope and system.
  await db.schema
    .createIndex('snapshot_delegation_lookup_idx')
    .on('snapshot_delegation')
    .columns(['delegator_address', 'network', 'delegation_system', 'space_id'])
    .execute();

  await db.schema
    .createIndex('snapshot_delegation_dao_idx')
    .on('snapshot_delegation')
    .columns(['dao_id', 'delegator_address', 'space_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('snapshot_delegation').execute();
}
