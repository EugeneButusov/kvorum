import { sql, type Kysely } from 'kysely';
import { chDb, pgDb } from './client';
import type { ClickHouseDatabase } from './schema/clickhouse';
import type { PgDatabase } from './schema/pg';

export type DelegationReadRow = {
  id: string;
  dao_id: string;
  voting_power: string;
  block_number: string;
  tx_hash: string;
  event_type: 'delegate_changed' | 'votes_changed';
  created_at: Date;
  dao_slug: string;
  delegator_actor_id: string;
  delegator_address: string;
  delegator_display_name: string | null;
  delegate_actor_id: string | null;
  delegate_address: string | null;
  delegate_display_name: string | null;
};

type DelegationFlowProjectionTable = {
  delegation_id: string;
  dao_id: string;
  delegator_address: string;
  delegate_address: string;
  voting_power: string;
  block_number: string;
  event_type: string;
  created_at: Date;
};

type DelegationReadClickHouseDatabase = ClickHouseDatabase & {
  delegation_flow_projection: DelegationFlowProjectionTable;
};

const ZERO_DELEGATE_ADDRESS = '0x0000000000000000000000000000000000000000';

export class DelegationReadRepository {
  private readonly pg: Kysely<PgDatabase>;
  private readonly ch: Kysely<DelegationReadClickHouseDatabase>;

  constructor(
    pg: Kysely<PgDatabase> = pgDb,
    ch: Kysely<DelegationReadClickHouseDatabase> = chDb as never,
  ) {
    this.pg = pg;
    this.ch = ch;
  }

  async listForDao(args: {
    daoId: string;
    delegatorAddress?: string;
    delegateAddress?: string;
    fromBlockMin?: string;
    fromBlockMax?: string;
  }): Promise<DelegationReadRow[]> {
    const dao = await this.pg
      .selectFrom('dao')
      .select(['id', 'slug'])
      .where('id', '=', args.daoId)
      .executeTakeFirst();
    if (dao === undefined) return [];

    let qb = this.ch
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection FINAL`.as('d'))
      .select([
        'd.delegation_id as id',
        'd.dao_id',
        'd.voting_power',
        'd.block_number',
        sql<string>`''`.as('tx_hash'),
        'd.event_type',
        'd.created_at',
        'd.delegator_address',
        'd.delegate_address',
      ])
      .where('d.dao_id', '=', args.daoId);

    if (args.delegatorAddress !== undefined) {
      qb = qb.where('d.delegator_address', '=', args.delegatorAddress.toLowerCase());
    }
    if (args.delegateAddress !== undefined) {
      qb = qb.where('d.delegate_address', '=', args.delegateAddress.toLowerCase());
    }
    if (args.fromBlockMin !== undefined) {
      qb = qb.where('d.block_number', '>=', args.fromBlockMin);
    }
    if (args.fromBlockMax !== undefined) {
      qb = qb.where('d.block_number', '<=', args.fromBlockMax);
    }

    const rows = await qb
      .orderBy('d.block_number', 'desc')
      .orderBy('d.delegation_id', 'desc')
      .execute();

    return this.hydrateRows(rows, dao.slug);
  }

  async currentDelegators(
    daoId: string,
    delegateActorId: string,
    asOfBlockNumber: string,
    limit: number,
    cursor?: string,
  ): Promise<DelegationReadRow[]> {
    const dao = await this.pg
      .selectFrom('dao')
      .select(['id', 'slug'])
      .where('id', '=', daoId)
      .executeTakeFirst();
    if (dao === undefined) return [];

    const delegateAddress = await this.primaryAddressForActor(delegateActorId);
    if (delegateAddress === undefined) return [];

    const rows = await this.ch
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection FINAL`.as('d'))
      .select([
        'd.delegation_id as id',
        'd.dao_id',
        'd.voting_power',
        'd.block_number',
        sql<string>`''`.as('tx_hash'),
        'd.event_type',
        'd.created_at',
        'd.delegator_address',
        'd.delegate_address',
      ])
      .where('d.dao_id', '=', daoId)
      .where('d.event_type', '=', 'delegate_changed')
      .where('d.delegate_address', '=', delegateAddress)
      .where('d.block_number', '<=', asOfBlockNumber)
      .where((eb) => (cursor == null ? eb.val(true) : eb('d.delegator_address', '>', cursor)))
      .orderBy('d.delegator_address', 'asc')
      .limit(limit + 1)
      .execute();

    return this.hydrateRows(rows, dao.slug);
  }

  async findCurrentDelegationForActor(
    daoId: string,
    delegatorActorId: string,
  ): Promise<DelegationReadRow | undefined> {
    const dao = await this.pg
      .selectFrom('dao')
      .select(['id', 'slug'])
      .where('id', '=', daoId)
      .executeTakeFirst();
    if (dao === undefined) return undefined;

    const delegatorAddress = await this.primaryAddressForActor(delegatorActorId);
    if (delegatorAddress === undefined) return undefined;

    const row = await this.ch
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection FINAL`.as('d'))
      .select([
        'd.delegation_id as id',
        'd.dao_id',
        'd.voting_power',
        'd.block_number',
        sql<string>`''`.as('tx_hash'),
        'd.event_type',
        'd.created_at',
        'd.delegator_address',
        'd.delegate_address',
      ])
      .where('d.dao_id', '=', daoId)
      .where('d.event_type', '=', 'delegate_changed')
      .where('d.delegator_address', '=', delegatorAddress)
      .orderBy('d.block_number', 'desc')
      .orderBy('d.delegation_id', 'desc')
      .executeTakeFirst();

    if (row === undefined) return undefined;
    const hydrated = await this.hydrateRows([row], dao.slug);
    return hydrated[0];
  }

  async currentConfirmedHead(daoId: string): Promise<string | null> {
    const row = await this.ch
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection FINAL`.as('d'))
      .select((eb) => eb.fn.max('d.block_number').as('max_block_number'))
      .where('d.dao_id', '=', daoId)
      .executeTakeFirst();

    return row?.max_block_number ?? null;
  }

  private async hydrateRows(
    rows: Array<{
      id: string;
      dao_id: string;
      voting_power: string;
      block_number: string;
      tx_hash: string;
      event_type: string;
      created_at: Date;
      delegator_address: string;
      delegate_address: string;
    }>,
    daoSlug: string,
  ): Promise<DelegationReadRow[]> {
    if (rows.length === 0) return [];
    const addresses = [
      ...new Set(rows.flatMap((row) => [row.delegator_address, row.delegate_address])),
    ]
      .filter((address) => address !== ZERO_DELEGATE_ADDRESS)
      .map((address) => address.toLowerCase());

    const actors =
      addresses.length === 0
        ? []
        : await this.pg
            .selectFrom('actor_address as aa')
            .innerJoin('actor as a', 'a.id', 'aa.actor_id')
            .select(['aa.address', 'a.id', 'a.display_name'])
            .where('aa.address', 'in', addresses)
            .execute();
    const actorByAddress = new Map(actors.map((row) => [row.address, row]));

    return rows.map((row) => {
      const delegatorAddress = row.delegator_address.toLowerCase();
      const delegateAddress = row.delegate_address.toLowerCase();
      const delegator = actorByAddress.get(delegatorAddress);
      const delegate = actorByAddress.get(delegateAddress);

      return {
        id: row.id,
        dao_id: row.dao_id,
        voting_power: row.voting_power,
        block_number: row.block_number,
        tx_hash: row.tx_hash,
        event_type: row.event_type as 'delegate_changed' | 'votes_changed',
        created_at: row.created_at,
        dao_slug: daoSlug,
        delegator_actor_id: delegator?.id ?? '',
        delegator_address: delegatorAddress,
        delegator_display_name: delegator?.display_name ?? null,
        delegate_actor_id:
          delegateAddress === ZERO_DELEGATE_ADDRESS ? null : (delegate?.id ?? null),
        delegate_address: delegateAddress === ZERO_DELEGATE_ADDRESS ? null : delegateAddress,
        delegate_display_name:
          delegateAddress === ZERO_DELEGATE_ADDRESS ? null : (delegate?.display_name ?? null),
      } satisfies DelegationReadRow;
    });
  }

  private async primaryAddressForActor(actorId: string): Promise<string | undefined> {
    const row = await this.pg
      .selectFrom('actor')
      .select('primary_address')
      .where('id', '=', actorId)
      .executeTakeFirst();
    return row?.primary_address;
  }
}
