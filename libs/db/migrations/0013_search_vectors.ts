import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

  await sql`
    ALTER TABLE proposal ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B')
    ) STORED
  `.execute(db);
  await sql`CREATE INDEX idx_proposal_search ON proposal USING gin(search_vector)`.execute(db);

  await sql`
    ALTER TABLE dao ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(slug, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B')
    ) STORED
  `.execute(db);
  await sql`CREATE INDEX idx_dao_search ON dao USING gin(search_vector)`.execute(db);

  await sql`
    ALTER TABLE actor ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(display_name, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(primary_address, '')), 'A')
    ) STORED
  `.execute(db);
  await sql`CREATE INDEX idx_actor_search ON actor USING gin(search_vector)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_actor_search`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_dao_search`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_proposal_search`.execute(db);

  await db.schema.alterTable('actor').dropColumn('search_vector').execute();
  await db.schema.alterTable('dao').dropColumn('search_vector').execute();
  await db.schema.alterTable('proposal').dropColumn('search_vector').execute();

  await sql`DROP EXTENSION IF EXISTS pg_trgm`.execute(db);
}
