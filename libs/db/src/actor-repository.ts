import type { Kysely } from 'kysely';
import type { Actor, PgDatabase } from './schema/pg';

export class ActorRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findOrCreateByAddress(address: string): Promise<Actor> {
    const normalized = address.toLowerCase();
    const now = new Date();

    const inserted = await this.db
      .insertInto('actor')
      .values({
        primary_address: normalized,
        updated_at: now,
      })
      .onConflict((oc) => oc.column('primary_address').doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted !== undefined) return inserted;

    const existing = await this.db
      .selectFrom('actor')
      .selectAll()
      .where('primary_address', '=', normalized)
      .executeTakeFirst();

    if (existing === undefined) {
      throw new Error(`actor insert conflicted but row was not found: ${normalized}`);
    }

    return existing;
  }
}
