import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Actor, PgDatabase } from './schema/pg';

export type ActorRedirectRow = {
  to_actor_id: string;
  survivor_primary_address: string;
};

export type ActorByAnyAddressRow = {
  actor_id: string;
  primary_address: string;
};

export type CurrentActorIdByAddressRow = {
  address: string;
  current_actor_id: string | null;
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

  async findCurrentActorIdsByAddresses(
    addresses: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (addresses.length === 0) return new Map();
    const normalized = [...new Set(addresses.map((address) => address.toLowerCase()))];

    const rows = (
      await sql<CurrentActorIdByAddressRow>`
        with input_addresses as (
          select unnest(array[${sql.join(normalized.map((address) => sql`${address}`))}]::text[]) as address
        )
        select
          i.address as address,
          coalesce(aa.actor_id, a.id, aar.to_actor_id) as current_actor_id
        from input_addresses i
        left join actor_address aa on aa.address = i.address
        left join actor a on a.primary_address = i.address
        left join actor_address_redirect aar on aar.from_address = i.address
      `.execute(this.db)
    ).rows;

    const byAddress = new Map(rows.map((row) => [row.address, row.current_actor_id]));
    for (const address of normalized) {
      if (!byAddress.has(address)) byAddress.set(address, null);
    }

    return byAddress;
  }
}
