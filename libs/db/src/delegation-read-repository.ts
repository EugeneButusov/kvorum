import type { Kysely } from 'kysely';
import { sql } from 'kysely';
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

export class DelegationReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  listBaseQuery() {
    return this.db
      .selectFrom('delegation')
      .innerJoin('dao', 'dao.id', 'delegation.dao_id')
      .innerJoin('actor as delegator', 'delegator.id', 'delegation.delegator_actor_id')
      .leftJoin('actor as delegate', 'delegate.id', 'delegation.delegate_actor_id')
      .select([
        'delegation.id',
        'delegation.dao_id',
        'delegation.voting_power',
        'delegation.block_number',
        'delegation.tx_hash',
        'delegation.event_type',
        'delegation.created_at',
        'dao.slug as dao_slug',
        'delegator.id as delegator_actor_id',
        'delegator.primary_address as delegator_address',
        'delegator.display_name as delegator_display_name',
        'delegate.id as delegate_actor_id',
        'delegate.primary_address as delegate_address',
        'delegate.display_name as delegate_display_name',
      ]);
  }

  async currentDelegators(
    daoId: string,
    delegateActorId: string,
    asOfBlockNumber: string,
    limit: number,
    cursor?: string,
  ): Promise<DelegationReadRow[]> {
    const cursorClause =
      cursor === undefined ? sql`` : sql`and latest.delegator_actor_id > ${cursor}::uuid`;

    const rows = await sql<DelegationReadRow>`
      with latest as (
        select distinct on (d.delegator_actor_id)
          d.id,
          d.dao_id,
          d.delegator_actor_id,
          d.delegate_actor_id,
          d.voting_power,
          d.block_number,
          d.tx_hash,
          d.event_type,
          d.created_at
        from delegation d
        where d.dao_id = ${daoId}
          and d.event_type = 'delegate_changed'
          and d.block_number <= ${asOfBlockNumber}::bigint
        order by d.delegator_actor_id, d.block_number desc, d.tx_index desc, d.log_index desc
      )
      select
        latest.id,
        latest.dao_id,
        latest.voting_power,
        latest.block_number,
        latest.tx_hash,
        latest.event_type,
        latest.created_at,
        dao.slug as dao_slug,
        delegator.id as delegator_actor_id,
        delegator.primary_address as delegator_address,
        delegator.display_name as delegator_display_name,
        delegate.id as delegate_actor_id,
        delegate.primary_address as delegate_address,
        delegate.display_name as delegate_display_name
      from latest
      join dao on dao.id = latest.dao_id
      join actor delegator on delegator.id = latest.delegator_actor_id
      left join actor delegate on delegate.id = latest.delegate_actor_id
      where latest.delegate_actor_id = ${delegateActorId}
      ${cursorClause}
      order by latest.delegator_actor_id asc
      limit ${limit + 1}
    `.execute(this.db);

    return rows.rows;
  }

  async findCurrentDelegationForActor(
    daoId: string,
    delegatorActorId: string,
  ): Promise<DelegationReadRow | undefined> {
    return this.listBaseQuery()
      .where('delegation.dao_id', '=', daoId)
      .where('delegation.delegator_actor_id', '=', delegatorActorId)
      .where('delegation.event_type', '=', 'delegate_changed')
      .orderBy('delegation.block_number', 'desc')
      .orderBy('delegation.tx_index', 'desc')
      .orderBy('delegation.log_index', 'desc')
      .executeTakeFirst();
  }

  async currentConfirmedHead(daoId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('delegation')
      .select(({ fn }) => fn.max('block_number').as('max_block_number'))
      .where('dao_id', '=', daoId)
      .executeTakeFirst();

    return row?.max_block_number ?? null;
  }
}
