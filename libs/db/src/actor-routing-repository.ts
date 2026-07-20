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

/** A non-canonical address and the address its owning actor is canonically known by. */
export type MergeMapEntry = {
  address: string;
  canonicalAddress: string;
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

  /**
   * THE definition of address→actor. Every consumer resolves identity through this, so there is one
   * rule in one place (ADR-087); ClickHouse previously carried a second, drifted copy in the
   * `actor_address_redirect` dictionary.
   *
   * The three coalesce arms, in priority order:
   *
   * 1. `aa.actor_id` — the address has an `actor_address` row. The normal case, and the only one
   *    that fires in production today: all 62,635 addresses resolve here.
   * 2. `a.id` — the address is some actor's `primary_address` but has no `actor_address` row. This
   *    arm is NOT merely defensive. {@link findMergeMap} canonicalises onto `actor.primary_address`,
   *    so if that row is ever missing, this is what still resolves the canonical address back to its
   *    actor. It also covers the window in which `findOrCreateActorAddress` has inserted the actor
   *    but not yet its address (two statements, no enclosing transaction).
   * 3. `aar.to_actor_id` — the address only appears in a redirect. Unreachable in practice:
   *    `executeMerge` retargets every one of the secondary's `actor_address` rows onto the survivor
   *    before inserting the redirect, so `from_address` is always present in `actor_address` and
   *    arm 1 wins. Kept because it costs nothing and is the correct answer if that ever changes.
   */
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

  /**
   * Every address that is not the canonical address of the actor owning it, paired with that
   * canonical address.
   *
   * This is the map ClickHouse needs in order to aggregate by actor without knowing what an actor is
   * (ADR-087): the analytics queries group on `transform(address, [from…], [to…], address)`, so a
   * merged actor's addresses collapse to one grouping key *before* any top-N cut — top-N by address
   * is not top-N by actor.
   *
   * Only merged actors contribute rows. An actor acquires a second address exactly one way —
   * `executeMerge` retargeting the absorbed actor's rows — so on a database with no merges this
   * returns empty and the `transform` degenerates to the identity function it replaces. Production
   * is in that state today (zero merged actors), which is what makes the query-embedded map viable;
   * see ADR-087's "scales with merge count" risk if that changes.
   *
   * Canonicalises onto `actor.primary_address` rather than an arbitrary owned address so the key is
   * stable across calls, which keeps cursors and cached pages coherent.
   */
  async findMergeMap(): Promise<MergeMapEntry[]> {
    const rows = await this.db
      .selectFrom('actor_address as aa')
      .innerJoin('actor as a', 'a.id', 'aa.actor_id')
      .select(['aa.address as address', 'a.primary_address as canonical_address'])
      .whereRef('aa.address', '<>', 'a.primary_address')
      // Deterministic order: the map is embedded in ClickHouse query text, and a stable ordering
      // keeps that text (and anything keyed on it) identical between identical calls.
      .orderBy('aa.address', 'asc')
      .execute();

    return rows.map((row) => ({
      address: row.address,
      canonicalAddress: row.canonical_address,
    }));
  }
}
