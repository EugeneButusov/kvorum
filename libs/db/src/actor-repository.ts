import type { Kysely, Transaction } from 'kysely';
import type { Actor, PgDatabase } from './schema/pg';

type ActorAddressSource = 'proposer_event' | 'voter_event' | 'delegator_event' | 'delegate_event';

export class ActorRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findOrCreateByAddress(address: string): Promise<Actor> {
    const normalized = address.toLowerCase();
    return this.findOrCreateByAddressTx(this.db, normalized);
  }

  async findOrCreateActorAddress(address: string, source: ActorAddressSource): Promise<Actor> {
    const normalized = address.toLowerCase();

    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('actor as a')
        .innerJoin('actor_address as aa', 'aa.actor_id', 'a.id')
        .selectAll('a')
        .where('aa.address', '=', normalized)
        .executeTakeFirst();

      if (existing !== undefined) return existing;

      const actor = await this.findOrCreateByAddressTx(trx, normalized);

      await trx
        .insertInto('actor_address')
        .values({
          actor_id: actor.id,
          address: normalized,
          is_primary: true,
          source,
        })
        .onConflict((oc) => oc.columns(['actor_id', 'address']).doNothing())
        .execute();

      return actor;
    });
  }

  private async findOrCreateByAddressTx(
    db: Kysely<PgDatabase> | Transaction<PgDatabase>,
    normalized: string,
  ): Promise<Actor> {
    const now = new Date();

    const inserted = await db
      .insertInto('actor')
      .values({
        primary_address: normalized,
        updated_at: now,
      })
      .onConflict((oc) => oc.column('primary_address').doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted !== undefined) return inserted;

    const existing = await db
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
