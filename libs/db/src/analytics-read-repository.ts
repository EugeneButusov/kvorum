import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';
import type { PgDatabase } from './schema/pg';

export type BucketGrain = 'daily' | 'weekly' | 'monthly';

function pgTimeBucketExpression(column: string, grain: BucketGrain): RawBuilder<Date> {
  const ref = sql.ref(column);
  if (grain === 'daily') return sql<Date>`date_trunc('day', ${ref})`;
  if (grain === 'weekly') return sql<Date>`date_trunc('week', ${ref})`;
  return sql<Date>`date_trunc('month', ${ref})`;
}

type VoteEventsAnalyticsTable = {
  vote_id: string;
  proposal_id: string;
  voter_actor_id: string;
  voter_address: string;
  dao_id: string;
  dao_slug: string;
  source_type: string;
  primary_choice: number;
  voting_power: string;
  cast_at: Date;
  created_at: Date;
  block_number: string;
  superseded: number;
};

type DelegationFlowAnalyticsTable = {
  delegation_id: string;
  delegator_actor_id: string;
  delegate_actor_id: string;
  dao_id: string;
  dao_slug: string;
  voting_power: string;
  block_number: string;
  event_type: string;
  created_at: Date;
};

export type AnalyticsClickHouseDatabase = ClickHouseDatabase & {
  vote_events_analytics: VoteEventsAnalyticsTable;
  delegation_flow_analytics: DelegationFlowAnalyticsTable;
};

const RESOLVED_PASS_STATES = ['executed', 'succeeded'] as const;
const RESOLVED_FAIL_STATES = ['defeated', 'expired', 'vetoed'] as const;
const RESOLVED_STATES = [...RESOLVED_PASS_STATES, ...RESOLVED_FAIL_STATES] as const;

export type PassRateRow = {
  source_type: string;
  bucket: Date;
  passed: number;
  failed: number;
  pass_rate: number | null;
};

export type ConcentrationBucketRow = {
  bucket: Date;
  weights: string[];
  delegate_count: number;
  total_voting_power: string;
};

export type DelegateAlignmentRow = {
  peer_actor_id: string;
  vote_count: number;
  shared_proposals: number;
  matched_choices: number;
};

export type DelegationFlowEdgeRow = {
  delegator_actor_id: string;
  delegate_actor_id: string;
  voting_power: string;
  block_number: string;
  event_type: string;
  created_at: Date;
};

export type ActorPowerRow = {
  actor_id: string;
  voting_power: string;
};

export type CrossDaoSummaryRow = {
  dao_id: string;
  dao_slug: string;
  voter_actor_id: string;
  votes_cast: number;
  last_active_at: Date | null;
};

export type MirrorEnvelope<T> = {
  rows: T[];
  mirrorLastEtl: Date | null;
};

export class AnalyticsReadRepository {
  constructor(
    private readonly chDb: Kysely<AnalyticsClickHouseDatabase>,
    private readonly pgDb: Kysely<PgDatabase>,
  ) {}

  async findEarliestDelegationEventAt(daoId: string): Promise<Date | null> {
    const row = await this.chDb
      .selectFrom(sql<DelegationFlowAnalyticsTable>`delegation_flow_analytics FINAL`.as('dfa'))
      .select((eb) => eb.fn.min('dfa.created_at').as('earliest'))
      .where('dfa.dao_id', '=', daoId)
      .executeTakeFirst();
    return row?.earliest ?? null;
  }

  async findGlobalEtlWatermark(): Promise<Date | null> {
    const row = await this.chDb
      .selectFrom(sql<VoteEventsAnalyticsTable>`vote_events_analytics FINAL`.as('vea'))
      .select((eb) => eb.fn.max('vea.created_at').as('watermark'))
      .executeTakeFirst();
    return row?.watermark ?? null;
  }

  async passRateByBucket(args: {
    daoId: string;
    bucket: BucketGrain;
    from?: Date;
    to?: Date;
    proposalType?: string;
  }): Promise<PassRateRow[]> {
    const bucketExpr = pgTimeBucketExpression('proposal.created_at', args.bucket).as('bucket');

    let qb = this.pgDb
      .selectFrom('proposal')
      .select('proposal.source_type')
      .select(bucketExpr)
      .select(
        sql<number>`count(*) filter (where proposal.state in (${sql.join(
          RESOLVED_PASS_STATES.map((s) => sql`${s}`),
        )}))`.as('passed'),
      )
      .select(
        sql<number>`count(*) filter (where proposal.state in (${sql.join(
          RESOLVED_FAIL_STATES.map((s) => sql`${s}`),
        )}))`.as('failed'),
      )
      .where('proposal.dao_id', '=', args.daoId)
      .where('proposal.state', 'in', [...RESOLVED_STATES])
      .groupBy(['proposal.source_type', 'bucket'])
      .orderBy('bucket', 'asc');

    if (args.from !== undefined) qb = qb.where('proposal.created_at', '>=', args.from);
    if (args.to !== undefined) qb = qb.where('proposal.created_at', '<=', args.to);
    if (args.proposalType !== undefined)
      qb = qb.where('proposal.source_type', '=', args.proposalType);

    const rows = await qb.execute();
    return rows.map((row) => {
      const passed = Number(row.passed);
      const failed = Number(row.failed);
      const denominator = passed + failed;
      return {
        source_type: row.source_type,
        bucket: row.bucket,
        passed,
        failed,
        pass_rate: denominator > 0 ? passed / denominator : null,
      };
    });
  }

  async concentrationByBucket(args: {
    daoId: string;
    from: Date;
    to: Date;
    bucket: BucketGrain;
  }): Promise<MirrorEnvelope<ConcentrationBucketRow>> {
    const chBucket =
      args.bucket === 'daily'
        ? sql<Date>`toStartOfDay(dfa.created_at)`
        : args.bucket === 'weekly'
          ? sql<Date>`toStartOfWeek(dfa.created_at)`
          : sql<Date>`toStartOfMonth(dfa.created_at)`;

    const rows = await this.chDb
      .selectFrom(sql<DelegationFlowAnalyticsTable>`delegation_flow_analytics FINAL`.as('dfa'))
      .select(chBucket.as('bucket'))
      .select(sql<string[]>`arraySort(groupArray(dfa.voting_power))`.as('weights'))
      .select(sql<number>`count(*)`.as('delegate_count'))
      .select(sql<string>`toString(sum(toUInt256(dfa.voting_power)))`.as('total_voting_power'))
      .where('dfa.dao_id', '=', args.daoId)
      .where('dfa.created_at', '>=', args.from)
      .where('dfa.created_at', '<=', args.to)
      .groupBy('bucket')
      .orderBy('bucket', 'asc')
      .execute();

    const mirrorLastEtl = rows.length === 0 ? null : (rows[rows.length - 1]?.bucket ?? null);
    return { rows, mirrorLastEtl };
  }

  async delegationFlowEdges(args: {
    daoId: string;
    from: Date;
    to: Date;
    minVotingPowerWei?: bigint;
  }): Promise<MirrorEnvelope<DelegationFlowEdgeRow>> {
    let qb = this.chDb
      .selectFrom(sql<DelegationFlowAnalyticsTable>`delegation_flow_analytics FINAL`.as('dfa'))
      .select([
        'dfa.delegator_actor_id',
        'dfa.delegate_actor_id',
        'dfa.voting_power',
        'dfa.block_number',
        'dfa.event_type',
        'dfa.created_at',
      ])
      .where('dfa.dao_id', '=', args.daoId)
      .where('dfa.created_at', '>=', args.from)
      .where('dfa.created_at', '<=', args.to)
      .orderBy('dfa.created_at', 'asc');

    if (args.minVotingPowerWei !== undefined) {
      qb = qb.where(
        sql<boolean>`toUInt256(dfa.voting_power) >= toUInt256(${args.minVotingPowerWei.toString()})`,
      );
    }

    const rows = await qb.execute();
    const mirrorLastEtl = rows.length === 0 ? null : (rows[rows.length - 1]?.created_at ?? null);
    return { rows, mirrorLastEtl };
  }

  async currentVotingPowerByActor(
    daoId: string,
    actorIds: readonly string[],
  ): Promise<ActorPowerRow[]> {
    if (actorIds.length === 0) return [];
    const rows = await this.chDb
      .selectFrom(sql<DelegationFlowAnalyticsTable>`delegation_flow_analytics FINAL`.as('dfa'))
      .select('dfa.delegator_actor_id as actor_id')
      .select(sql<string>`argMax(dfa.voting_power, dfa.created_at)`.as('voting_power'))
      .where('dfa.dao_id', '=', daoId)
      .where('dfa.delegator_actor_id', 'in', [...actorIds])
      .groupBy('dfa.delegator_actor_id')
      .execute();

    return rows;
  }

  async findActors(
    actorIds: readonly string[],
  ): Promise<Array<{ id: string; primary_address: string; display_name: string | null }>> {
    if (actorIds.length === 0) return [];
    return this.pgDb
      .selectFrom('actor')
      .select(['id', 'primary_address', 'display_name'])
      .where('id', 'in', [...actorIds])
      .execute();
  }

  async delegateAlignmentPage(args: {
    daoId: string;
    focalActorId: string;
    limit: number;
    from?: Date;
    to?: Date;
    sort: 'vote_count' | 'alignment_score';
    dir: 'asc' | 'desc';
  }): Promise<MirrorEnvelope<DelegateAlignmentRow>> {
    const orderExpr =
      args.sort === 'alignment_score'
        ? sql`matched_choices / nullIf(shared_proposals, 0)`
        : sql`vote_count`;

    const dir = args.dir;
    const rows = await this.chDb
      .with('focal', (db) => {
        let inner = db
          .selectFrom(sql<VoteEventsAnalyticsTable>`vote_events_analytics FINAL`.as('v'))
          .select(['v.proposal_id', 'v.primary_choice'])
          .where('v.dao_id', '=', args.daoId)
          .where('v.voter_actor_id', '=', args.focalActorId)
          .where('v.superseded', '=', 0);
        if (args.from !== undefined) inner = inner.where('v.cast_at', '>=', args.from);
        if (args.to !== undefined) inner = inner.where('v.cast_at', '<=', args.to);
        return inner;
      })
      .selectFrom(sql<VoteEventsAnalyticsTable>`vote_events_analytics FINAL`.as('v2'))
      .innerJoin('focal', 'focal.proposal_id', 'v2.proposal_id')
      .select('v2.voter_actor_id as peer_actor_id')
      .select(sql<number>`count(*)`.as('vote_count'))
      .select(sql<number>`count(*)`.as('shared_proposals'))
      .select(
        sql<number>`sum(if(v2.primary_choice = focal.primary_choice, 1, 0))`.as('matched_choices'),
      )
      .where('v2.dao_id', '=', args.daoId)
      .where('v2.superseded', '=', 0)
      .where('v2.voter_actor_id', '!=', args.focalActorId)
      .groupBy('v2.voter_actor_id')
      .orderBy(orderExpr, dir)
      .orderBy('peer_actor_id', dir)
      .limit(args.limit + 1)
      .execute();

    const mirrorLastEtl = await this.findGlobalEtlWatermark();
    return { rows, mirrorLastEtl };
  }

  async crossDaoSummaryForActor(rawAddress: string): Promise<MirrorEnvelope<CrossDaoSummaryRow>> {
    const rows = await this.chDb
      .selectFrom(sql<VoteEventsAnalyticsTable>`vote_events_analytics FINAL`.as('v'))
      .select(['v.dao_id', 'v.dao_slug', 'v.voter_actor_id'])
      .select(sql<number>`count(*)`.as('votes_cast'))
      .select((eb) => eb.fn.max('v.cast_at').as('last_active_at'))
      .where('v.voter_address', '=', rawAddress.toLowerCase())
      .where('v.superseded', '=', 0)
      .groupBy(['v.dao_id', 'v.dao_slug', 'v.voter_actor_id'])
      .execute();

    const mirrorLastEtl = await this.findGlobalEtlWatermark();
    return { rows, mirrorLastEtl };
  }

  async alignmentWithMajorityForActor(
    actorId: string,
    daoIds: readonly string[],
  ): Promise<Map<string, { matches: number; denom: number }>> {
    if (daoIds.length === 0) return new Map();

    const rows = await this.pgDb
      .selectFrom('vote')
      .innerJoin('proposal', 'proposal.id', 'vote.proposal_id')
      .select('proposal.dao_id as dao_id')
      .select(
        sql<number>`sum(case
          when vote.choice = 'For' and proposal.state in ('executed', 'succeeded') then 1
          when vote.choice = 'Against' and proposal.state in ('defeated', 'expired', 'vetoed') then 1
          else 0
        end)`.as('matches'),
      )
      .select(
        sql<number>`sum(case
          when vote.choice in ('For', 'Against')
            and proposal.state in ('executed', 'succeeded', 'defeated', 'expired', 'vetoed') then 1
          else 0
        end)`.as('denom'),
      )
      .where('vote.voter_actor_id', '=', actorId)
      .where('proposal.dao_id', 'in', [...daoIds])
      .groupBy('proposal.dao_id')
      .execute();

    return new Map(
      rows.map((r) => [r.dao_id, { matches: Number(r.matches), denom: Number(r.denom) }]),
    );
  }
}
