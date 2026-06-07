import { sql, type Kysely, type Transaction } from 'kysely';
import type { Actor, ActorAddress, PgDatabase } from './schema/pg';

type ActorAddressSource = 'proposer_event' | 'voter_event' | 'delegator_event' | 'delegate_event';

export interface ActorOverviewAddress {
  address: string;
  isPrimary: boolean;
  source: string;
}

export interface ActorOverviewRedirect {
  fromAddress: string;
  toActorId: string;
  mergedAt: Date;
  mergeReason: string;
  createdBy: string;
}

export interface ActorOverview {
  actorId: string;
  primaryAddress: string;
  addresses: ActorOverviewAddress[];
  mergedIntoActorId: string | null;
  inboundRedirects: ActorOverviewRedirect[];
}

export class ActorRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findEnsRefreshCandidates(args: {
    limit: number;
    ttlSeconds: number;
  }): Promise<Array<{ id: string; primary_address: string }>> {
    const base = this.db
      .selectFrom('actor')
      .select(['id', 'primary_address'])
      .where('merged_into_actor_id', 'is', null)
      .orderBy('updated_at', 'asc')
      .orderBy('id', 'asc')
      .limit(args.limit);

    if (args.ttlSeconds <= 0) {
      return base.execute();
    }

    return base
      .where((eb) =>
        eb.or([
          eb('display_name', 'is', null),
          sql<boolean>`updated_at < now() - make_interval(secs => ${args.ttlSeconds})`,
        ]),
      )
      .execute();
  }

  async updateDisplayName(args: { actorId: string; displayName: string | null }): Promise<void> {
    await this.db
      .updateTable('actor')
      .set({
        display_name: args.displayName,
        updated_at: sql`now()`,
      })
      .where('id', '=', args.actorId)
      .where('merged_into_actor_id', 'is', null)
      .execute();
  }

  async findByAddress(address: string): Promise<Actor | undefined> {
    const normalized = address.toLowerCase();
    return this.db
      .selectFrom('actor as a')
      .innerJoin('actor_address as aa', 'aa.actor_id', 'a.id')
      .selectAll('a')
      .where('aa.address', '=', normalized)
      .executeTakeFirst();
  }

  async findIdByAddress(address: string): Promise<string | undefined> {
    const actor = await this.findByAddress(address);
    return actor?.id;
  }

  async findOrCreateByAddress(address: string): Promise<Actor> {
    const normalized = address.toLowerCase();
    return this.findOrCreateByAddressTx(this.db, normalized);
  }

  async findOrCreateActorAddress(address: string, source: ActorAddressSource): Promise<Actor> {
    const normalized = address.toLowerCase();
    const existing = await this.db
      .selectFrom('actor as a')
      .innerJoin('actor_address as aa', 'aa.actor_id', 'a.id')
      .selectAll('a')
      .where('aa.address', '=', normalized)
      .executeTakeFirst();

    if (existing !== undefined) return existing;

    const actor = await this.findOrCreateByAddressTx(this.db, normalized);

    await this.db
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
  }

  async findPrimaryAddressesByActorIds(
    actorIds: readonly string[],
  ): Promise<Array<{ actor_id: string; address: string }>> {
    if (actorIds.length === 0) return [];

    return this.db
      .selectFrom('actor_address')
      .select(['actor_id', 'address'])
      .where('actor_id', 'in', [...actorIds])
      .where('is_primary', '=', true)
      .execute();
  }

  async findActorsByAddresses(addresses: readonly string[]): Promise<Array<{ id: string }>> {
    if (addresses.length === 0) return [];
    return this.db
      .selectFrom('actor_address')
      .select(['actor_id as id'])
      .where('address', 'in', [...addresses])
      .execute();
  }

  async listAddressesForActor(actorId: string): Promise<ActorAddress[]> {
    return this.db
      .selectFrom('actor_address')
      .selectAll()
      .where('actor_id', '=', actorId)
      .orderBy('is_primary', 'desc')
      .orderBy('address', 'asc')
      .execute();
  }

  async findActorOverview(address: string): Promise<ActorOverview | null> {
    const normalized = address.toLowerCase();
    const rows = await this.db
      .selectFrom('actor as a')
      .innerJoin('actor_address as lookup', 'lookup.actor_id', 'a.id')
      .leftJoin('actor_address as aa', 'aa.actor_id', 'a.id')
      .leftJoin('actor_address_redirect as ar', 'ar.to_actor_id', 'a.id')
      .select([
        'a.id as actorId',
        'a.primary_address as primaryAddress',
        'a.merged_into_actor_id as mergedIntoActorId',
        'aa.address as address',
        'aa.is_primary as isPrimary',
        'aa.source as source',
        'ar.from_address as fromAddress',
        'ar.to_actor_id as toActorId',
        'ar.merged_at as mergedAt',
        'ar.merge_reason as mergeReason',
        'ar.created_by as createdBy',
      ])
      .where('lookup.address', '=', normalized)
      .execute();

    if (rows.length === 0) return null;

    const first = rows[0]!;
    const addressesByKey = new Map<string, ActorOverviewAddress>();
    const redirectsByKey = new Map<string, ActorOverviewRedirect>();

    for (const row of rows) {
      if (row.address != null && !addressesByKey.has(row.address)) {
        addressesByKey.set(row.address, {
          address: row.address,
          isPrimary: row.isPrimary ?? false,
          source: row.source ?? '',
        });
      }

      if (row.fromAddress != null && !redirectsByKey.has(row.fromAddress)) {
        redirectsByKey.set(row.fromAddress, {
          fromAddress: row.fromAddress,
          toActorId: row.toActorId ?? first.actorId,
          mergedAt: row.mergedAt ?? new Date(0),
          mergeReason: row.mergeReason ?? '',
          createdBy: row.createdBy ?? '',
        });
      }
    }

    const addresses = [...addressesByKey.values()].sort((left, right) => {
      if (left.isPrimary && !right.isPrimary) return -1;
      if (!left.isPrimary && right.isPrimary) return 1;
      return left.address.localeCompare(right.address);
    });
    const inboundRedirects = [...redirectsByKey.values()].sort((left, right) =>
      left.fromAddress.localeCompare(right.fromAddress),
    );

    return {
      actorId: first.actorId,
      primaryAddress: first.primaryAddress,
      addresses,
      mergedIntoActorId: first.mergedIntoActorId,
      inboundRedirects,
    };
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
