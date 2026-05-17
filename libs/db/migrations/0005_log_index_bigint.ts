import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// archive_confirmation.log_index and ingestion_dlq.archive_log_index were typed
// as integer (signed 32-bit, max 2,147,483,647). Ethereum's logIndex field is
// technically uint256 and practically uint32; max uint32 (4,294,967,295) overflows
// a signed integer column. Widen to bigint to cover the full uint32 range.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE archive_confirmation ALTER COLUMN log_index TYPE bigint`.execute(db);
  await sql`ALTER TABLE ingestion_dlq ALTER COLUMN archive_log_index TYPE bigint`.execute(db);
  await sql`ALTER TABLE ingestion_dlq_resolved ALTER COLUMN archive_log_index TYPE bigint`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE archive_confirmation ALTER COLUMN log_index TYPE integer`.execute(db);
  await sql`ALTER TABLE ingestion_dlq ALTER COLUMN archive_log_index TYPE integer`.execute(db);
  await sql`ALTER TABLE ingestion_dlq_resolved ALTER COLUMN archive_log_index TYPE integer`.execute(
    db,
  );
}
