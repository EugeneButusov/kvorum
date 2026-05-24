import type { Kysely } from 'kysely';
import type { Actor, PgDatabase } from './schema/pg';

export type ActorRedirectRow = {
  to_actor_id: string;
  survivor_primary_address: string;
};

export type ActorByAnyAddressRow = {
  actor_id: string;
  primary_address: string;
};

export class ActorRoutingReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findLiveActorByPrimaryAddress(address: string): Promise<Actor | undefined> {
    return this.db
      .selectFrom('actor')
      .selectAll()
      .where('primary_address', '=', address.toLowerCase())
      .where('merged_into_actor_id', 'is', null)
      .executeTakeFirst();
  }

  async findRedirect(fromAddress: string): Promise<ActorRedirectRow | undefined> {
    return this.db
      .selectFrom('actor_address_redirect as aar')
      .innerJoin('actor as a', 'a.id', 'aar.to_actor_id')
      .select(['aar.to_actor_id as to_actor_id', 'a.primary_address as survivor_primary_address'])
      .where('aar.from_address', '=', fromAddress.toLowerCase())
      .executeTakeFirst();
  }

  async findLiveActorByAnyAddress(address: string): Promise<ActorByAnyAddressRow | undefined> {
    return this.db
      .selectFrom('actor as a')
      .innerJoin('actor_address as aa', 'aa.actor_id', 'a.id')
      .select(['a.id as actor_id', 'a.primary_address'])
      .where('aa.address', '=', address.toLowerCase())
      .executeTakeFirst();
  }
}
