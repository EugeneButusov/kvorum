import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE dao_source
      ADD COLUMN chain_id varchar(32) NOT NULL DEFAULT '0x1'
  `.execute(db);

  await sql`
    UPDATE dao_source ds
       SET chain_id = d.primary_chain_id
      FROM dao d
     WHERE d.id = ds.dao_id
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE dao_source DROP COLUMN chain_id`.execute(db);
}
