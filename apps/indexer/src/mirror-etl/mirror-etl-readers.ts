import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewDelegationFlowAnalytics, NewVoteEventsAnalytics } from '@sources/core';

const NULL_DELEGATE_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

interface StreamOptions {
  fromExclusive: Date;
  toInclusive: Date;
  batchSize: number;
  overlapHours: number;
}

interface VoteEtlRow {
  vote_id: string;
  proposal_id: string;
  voter_actor_id: string;
  voter_address: string;
  dao_id: string;
  dao_slug: string;
  source_type: string;
  primary_choice: number | null;
  voting_power: string;
  cast_at: Date;
  created_at: Date;
  block_number: string;
  superseded_by_vote_id: string | null;
}

interface DelegationEtlRow {
  delegation_id: string;
  delegator_actor_id: string;
  delegate_actor_id: string | null;
  dao_id: string;
  dao_slug: string;
  voting_power: string;
  block_number: string;
  event_type: string;
  created_at: Date;
}

export async function* streamVoteRowsForEtl(
  pg: Kysely<PgDatabase>,
  opts: StreamOptions,
): AsyncGenerator<NewVoteEventsAnalytics[]> {
  let cursor: { created_at: Date; vote_id: string } | undefined;
  const overlapStart = new Date(opts.fromExclusive.getTime() - opts.overlapHours * 60 * 60 * 1000);

  while (true) {
    let qb = pg
      .selectFrom('vote as v')
      .innerJoin('actor_address as aa', (join) =>
        join.onRef('aa.actor_id', '=', 'v.voter_actor_id').on('aa.is_primary', '=', true),
      )
      .innerJoin('proposal as p', 'p.id', 'v.proposal_id')
      .innerJoin('dao as d', 'd.id', 'p.dao_id')
      .select([
        'v.id as vote_id',
        'v.proposal_id',
        'v.voter_actor_id',
        'aa.address as voter_address',
        'p.dao_id',
        'd.slug as dao_slug',
        'p.source_type',
        'v.primary_choice',
        'v.voting_power_reported as voting_power',
        'v.cast_at',
        'v.created_at',
        'v.block_number',
        'v.superseded_by_vote_id',
      ])
      .where('v.created_at', '>', overlapStart)
      .where('v.created_at', '<=', opts.toInclusive)
      .where('v.block_number', 'is not', null)
      .orderBy('v.created_at', 'asc')
      .orderBy('v.id', 'asc')
      .limit(opts.batchSize);

    if (cursor !== undefined) {
      const currentCursor = cursor;
      qb = qb.where((eb) =>
        eb.or([
          eb('v.created_at', '>', currentCursor.created_at),
          eb.and([
            eb('v.created_at', '=', currentCursor.created_at),
            eb('v.id', '>', currentCursor.vote_id),
          ]),
        ]),
      );
    }

    const rows = (await qb.execute()) as VoteEtlRow[];
    if (rows.length === 0) {
      return;
    }

    const tail = rows[rows.length - 1]!;
    cursor = { created_at: tail.created_at, vote_id: tail.vote_id };
    yield rows.map(toVoteEventsAnalyticsRow);
  }
}

export async function* streamDelegationRowsForEtl(
  pg: Kysely<PgDatabase>,
  opts: StreamOptions,
): AsyncGenerator<NewDelegationFlowAnalytics[]> {
  let cursor: { created_at: Date; delegation_id: string } | undefined;
  const overlapStart = new Date(opts.fromExclusive.getTime() - opts.overlapHours * 60 * 60 * 1000);

  while (true) {
    let qb = pg
      .selectFrom('delegation as d1')
      .innerJoin('dao as d2', 'd2.id', 'd1.dao_id')
      .select([
        'd1.id as delegation_id',
        'd1.delegator_actor_id',
        'd1.delegate_actor_id',
        'd1.dao_id',
        'd2.slug as dao_slug',
        'd1.voting_power',
        'd1.block_number',
        'd1.event_type',
        'd1.created_at',
      ])
      .where('d1.created_at', '>', overlapStart)
      .where('d1.created_at', '<=', opts.toInclusive)
      .orderBy('d1.created_at', 'asc')
      .orderBy('d1.id', 'asc')
      .limit(opts.batchSize);

    if (cursor !== undefined) {
      const currentCursor = cursor;
      qb = qb.where((eb) =>
        eb.or([
          eb('d1.created_at', '>', currentCursor.created_at),
          eb.and([
            eb('d1.created_at', '=', currentCursor.created_at),
            eb('d1.id', '>', currentCursor.delegation_id),
          ]),
        ]),
      );
    }

    const rows = (await qb.execute()) as DelegationEtlRow[];
    if (rows.length === 0) {
      return;
    }

    const tail = rows[rows.length - 1]!;
    cursor = { created_at: tail.created_at, delegation_id: tail.delegation_id };
    yield rows.map(toDelegationFlowAnalyticsRow);
  }
}

export function toVoteEventsAnalyticsRow(row: VoteEtlRow): NewVoteEventsAnalytics {
  return {
    vote_id: row.vote_id,
    proposal_id: row.proposal_id,
    voter_actor_id: row.voter_actor_id,
    voter_address: row.voter_address.toLowerCase(),
    dao_id: row.dao_id,
    dao_slug: row.dao_slug,
    source_type: row.source_type,
    primary_choice: row.primary_choice ?? -1,
    voting_power: row.voting_power,
    cast_at: row.cast_at,
    created_at: row.created_at,
    block_number: row.block_number,
    superseded: row.superseded_by_vote_id != null ? 1 : 0,
  };
}

export function toDelegationFlowAnalyticsRow(row: DelegationEtlRow): NewDelegationFlowAnalytics {
  return {
    delegation_id: row.delegation_id,
    delegator_actor_id: row.delegator_actor_id,
    delegate_actor_id: row.delegate_actor_id ?? NULL_DELEGATE_ACTOR_ID,
    dao_id: row.dao_id,
    dao_slug: row.dao_slug,
    voting_power: row.voting_power,
    block_number: row.block_number,
    event_type: row.event_type,
    created_at: row.created_at,
  };
}
