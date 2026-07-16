import { sql, type Kysely, type RawBuilder } from 'kysely';
import { chTimestampToDate } from './ch-timestamp';
import type { ClickHouseDatabase } from './schema/clickhouse';
import type { PgDatabase } from './schema/pg';
import type {
  DelegationFlowProjectionTable,
  VoteEventsProjectionTable,
  VoteEventsRawTable,
} from './schema/projections';

export type BucketGrain = 'daily' | 'weekly' | 'monthly';

function pgTimeBucketExpression(column: string, grain: BucketGrain): RawBuilder<Date> {
  const ref = sql.ref(column);
  if (grain === 'daily') return sql<Date>`date_trunc('day', ${ref})`;
  if (grain === 'weekly') return sql<Date>`date_trunc('week', ${ref})`;
  return sql<Date>`date_trunc('month', ${ref})`;
}

export type AnalyticsClickHouseDatabase = ClickHouseDatabase;

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

export type DelegateLeaderboardRow = {
  actor_id: string;
  voting_power: string;
  delegator_count: number;
};

export type MirrorEnvelope<T> = {
  rows: T[];
  mirrorLastEtl: Date | null;
};

export class AnalyticsReadRepository {
  constructor(
    private readonly chDb: Kysely<ClickHouseDatabase>,
    private readonly pgDb: Kysely<PgDatabase>,
  ) {}

  async findEarliestDelegationEventAt(daoId: string): Promise<Date | null> {
    const row = await this.chDb
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection`.as('dfa'))
      .select((eb) => eb.fn.min('dfa.created_at').as('earliest'))
      .where('dfa.dao_id', '=', daoId)
      .executeTakeFirst();
    return row?.earliest != null ? chTimestampToDate(row.earliest as unknown as string) : null;
  }

  async findGlobalEtlWatermark(): Promise<Date | null> {
    // version is the ingestion timestamp; raw table preserves it; the VIEW does not expose it.
    const row = await this.chDb
      .selectFrom(sql<VoteEventsRawTable>`vote_events_raw`.as('vea'))
      .select((eb) => eb.fn.max('vea.version').as('watermark'))
      .executeTakeFirst();
    return row?.watermark != null ? chTimestampToDate(row.watermark as unknown as string) : null;
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
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection`.as('dfa'))
      .select(chBucket.as('bucket'))
      .select(sql<string[]>`arraySort(groupArray(dfa.voting_power))`.as('weights'))
      .select(sql<number>`count(*)`.as('delegate_count'))
      .select(sql<string>`toString(sum(toUInt256(dfa.voting_power)))`.as('total_voting_power'))
      .where('dfa.dao_id', '=', args.daoId)
      .where(sql<boolean>`dfa.created_at >= fromUnixTimestamp64Milli(${args.from.getTime()})`)
      .where(sql<boolean>`dfa.created_at <= fromUnixTimestamp64Milli(${args.to.getTime()})`)
      .groupBy('bucket')
      .orderBy('bucket', 'asc')
      .execute();

    const convertedRows: ConcentrationBucketRow[] = rows.map((row) => ({
      ...row,
      bucket: chTimestampToDate(row.bucket as unknown as string),
      delegate_count: Number(row.delegate_count),
    }));
    const lastBucket = convertedRows[convertedRows.length - 1]?.bucket ?? null;
    return { rows: convertedRows, mirrorLastEtl: lastBucket };
  }

  async delegationFlowEdges(args: {
    daoId: string;
    from: Date;
    to: Date;
    minVotingPowerWei?: bigint;
  }): Promise<MirrorEnvelope<DelegationFlowEdgeRow>> {
    let qb = this.chDb
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection`.as('dfa'))
      .select([
        sql<string>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(dfa.delegator_address))`.as(
          'delegator_actor_id',
        ),
        sql<string>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(dfa.delegate_address))`.as(
          'delegate_actor_id',
        ),
        'dfa.voting_power',
        'dfa.block_number',
        'dfa.event_type',
        'dfa.created_at',
      ])
      .where('dfa.dao_id', '=', args.daoId)
      .where(sql<boolean>`dfa.created_at >= fromUnixTimestamp64Milli(${args.from.getTime()})`)
      .where(sql<boolean>`dfa.created_at <= fromUnixTimestamp64Milli(${args.to.getTime()})`)
      .orderBy('dfa.created_at', 'asc');

    if (args.minVotingPowerWei !== undefined) {
      qb = qb.where(
        sql<boolean>`toUInt256(dfa.voting_power) >= toUInt256(${args.minVotingPowerWei.toString()})`,
      );
    }

    const rawRows = await qb.execute();
    const rows: DelegationFlowEdgeRow[] = rawRows.map((row) => ({
      ...row,
      created_at: chTimestampToDate(row.created_at as unknown as string),
    }));
    const lastCreatedAt = rows[rows.length - 1]?.created_at ?? null;
    return { rows, mirrorLastEtl: lastCreatedAt };
  }

  async currentVotingPowerByActor(
    daoId: string,
    actorIds: readonly string[],
  ): Promise<ActorPowerRow[]> {
    if (actorIds.length === 0) return [];
    const rows = await this.chDb
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection`.as('dfa'))
      .select(
        sql<string>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(dfa.delegator_address))`.as(
          'actor_id',
        ),
      )
      // toString(): a bare UInt256 comes back as a JS number on a server with
      // output_format_json_quote_64bit_integers=0 (production), losing precision and stringifying
      // to exponential notation past 1e21 — see vote-read-repository.ts.
      .select(sql<string>`toString(argMax(dfa.voting_power, dfa.created_at))`.as('voting_power'))
      .where('dfa.dao_id', '=', daoId)
      .where(
        sql<boolean>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(dfa.delegator_address)) in (${sql.join(
          actorIds.map((id) => sql`${id}`),
        )})`,
      )
      .groupBy('actor_id')
      .execute();

    return rows;
  }

  /**
   * Top delegates by current received voting power. Reduce the flow projection to each delegator's
   * latest delegation (argMax by created_at), then aggregate the power-bearing ones per delegate
   * (resolved to a canonical actor via the address→actor dictionary). Returns the ranked rows plus
   * the DAO-wide delegated total so callers can compute each delegate's share. Non-power-bearing
   * DAOs (Compound-style relationship rows with voting_power='0') yield an empty leaderboard.
   */
  async delegateLeaderboard(args: {
    daoId: string;
    limit: number;
  }): Promise<{ rows: DelegateLeaderboardRow[]; totalVotingPower: string }> {
    const currentPerDelegator = sql`
      SELECT
        argMax(delegate_address, created_at) AS delegate_address,
        argMax(toUInt256(voting_power), created_at) AS vp
      FROM delegation_flow_projection
      WHERE dao_id = ${args.daoId}
      GROUP BY delegator_address
    `;

    const leaderboard = await sql<{
      actor_id: string;
      voting_power: string;
      delegator_count: string;
    }>`
      SELECT
        dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(delegate_address)) AS actor_id,
        toString(sum(vp)) AS voting_power,
        toString(count()) AS delegator_count
      FROM (${currentPerDelegator})
      WHERE vp > 0 AND actor_id IS NOT NULL
      GROUP BY actor_id
      ORDER BY sum(vp) DESC, actor_id ASC
      LIMIT ${sql.lit(args.limit)}
    `.execute(this.chDb);

    const totalRow = await sql<{ total: string }>`
      SELECT toString(sum(vp)) AS total FROM (${currentPerDelegator}) WHERE vp > 0
    `.execute(this.chDb);

    return {
      rows: leaderboard.rows.map((r) => ({
        actor_id: r.actor_id,
        voting_power: r.voting_power,
        delegator_count: Number(r.delegator_count),
      })),
      totalVotingPower: totalRow.rows[0]?.total ?? '0',
    };
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
          .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
          .select(['v.proposal_id', 'v.primary_choice'])
          .where('v.dao_id', '=', args.daoId)
          .where(
            sql<boolean>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(v.voter_address)) = ${args.focalActorId}`,
          )
          .where('v.superseded', '=', 0);
        if (args.from !== undefined)
          inner = inner.where(
            sql<boolean>`v.cast_at >= fromUnixTimestamp64Milli(${args.from.getTime()})`,
          );
        if (args.to !== undefined)
          inner = inner.where(
            sql<boolean>`v.cast_at <= fromUnixTimestamp64Milli(${args.to.getTime()})`,
          );
        return inner;
      })
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v2'))
      .innerJoin('focal', 'focal.proposal_id', 'v2.proposal_id')
      .select(
        sql<string>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(v2.voter_address))`.as(
          'peer_actor_id',
        ),
      )
      .select(sql<number>`count(*)`.as('vote_count'))
      .select(sql<number>`count(*)`.as('shared_proposals'))
      .select(
        sql<number>`sum(if(v2.primary_choice = focal.primary_choice, 1, 0))`.as('matched_choices'),
      )
      .where('v2.dao_id', '=', args.daoId)
      .where('v2.superseded', '=', 0)
      .where(
        sql<boolean>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(v2.voter_address)) != ${args.focalActorId}`,
      )
      .groupBy('peer_actor_id')
      .orderBy(orderExpr, dir)
      .orderBy('peer_actor_id', dir)
      .limit(args.limit + 1)
      .execute();

    const mirrorLastEtl = await this.findGlobalEtlWatermark();
    return {
      rows: rows.map((row) => ({
        ...row,
        vote_count: Number(row.vote_count),
        shared_proposals: Number(row.shared_proposals),
        matched_choices: Number(row.matched_choices),
      })),
      mirrorLastEtl,
    };
  }

  async crossDaoSummaryForActor(actorId: string): Promise<MirrorEnvelope<CrossDaoSummaryRow>> {
    // Fetch ALL addresses for this actor (primary + absorbed-and-rewritten from merges).
    // Using actor_address keyed by actor_id ensures votes cast under any historical address
    // are counted — not just the current primary_address.
    const addressRows = await this.pgDb
      .selectFrom('actor_address')
      .select('address')
      .where('actor_id', '=', actorId)
      .execute();
    const addresses = addressRows.map((r) => r.address);

    if (addresses.length === 0) {
      const mirrorLastEtl = await this.findGlobalEtlWatermark();
      return { rows: [], mirrorLastEtl };
    }

    const chRows = await this.chDb
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select([
        'v.dao_id',
        sql<string>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(v.voter_address))`.as(
          'voter_actor_id',
        ),
      ])
      .select(sql<number>`count(*)`.as('votes_cast'))
      .select((eb) => eb.fn.max('v.cast_at').as('last_active_at'))
      .where('v.voter_address', 'in', addresses)
      .where('v.superseded', '=', 0)
      .groupBy(['v.dao_id', 'voter_actor_id'])
      .execute();

    const daoIds = [...new Set(chRows.map((row) => row.dao_id))];
    const daos =
      daoIds.length === 0
        ? []
        : await this.pgDb
            .selectFrom('dao')
            .select(['id', 'slug'])
            .where('id', 'in', daoIds)
            .execute();
    const daoSlugById = new Map(daos.map((dao) => [dao.id, dao.slug]));
    const rows: CrossDaoSummaryRow[] = chRows.map((row) => ({
      dao_id: row.dao_id,
      dao_slug: daoSlugById.get(row.dao_id) ?? '',
      voter_actor_id: row.voter_actor_id,
      votes_cast: Number(row.votes_cast),
      last_active_at:
        row.last_active_at != null
          ? chTimestampToDate(row.last_active_at as unknown as string)
          : null,
    }));

    const mirrorLastEtl = await this.findGlobalEtlWatermark();
    return { rows, mirrorLastEtl };
  }

  async alignmentWithMajorityForActor(
    actorId: string,
    daoIds: readonly string[],
  ): Promise<Map<string, { matches: number; denom: number }>> {
    if (daoIds.length === 0) return new Map();

    const proposals = await this.pgDb
      .selectFrom('proposal')
      .select(['id', 'dao_id', 'state'])
      .where('dao_id', 'in', [...daoIds])
      .where('state', 'in', [...RESOLVED_STATES])
      .execute();

    if (proposals.length === 0) return new Map();

    const proposalById = new Map(proposals.map((row) => [row.id, row]));
    const voteRows = await this.chDb
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select(['v.proposal_id', 'v.primary_choice'])
      .where('v.superseded', '=', 0)
      .where(
        sql<boolean>`dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(v.voter_address)) = ${actorId}`,
      )
      .where(
        'v.proposal_id',
        'in',
        proposals.map((proposal) => proposal.id),
      )
      .execute();

    const result = new Map<string, { matches: number; denom: number }>();
    for (const row of voteRows) {
      const proposal = proposalById.get(row.proposal_id);
      if (proposal === undefined) continue;
      if (row.primary_choice !== 0 && row.primary_choice !== 1) continue;

      const current = result.get(proposal.dao_id) ?? { matches: 0, denom: 0 };
      current.denom += 1;
      if (
        (row.primary_choice === 1 && RESOLVED_PASS_STATES.includes(proposal.state as never)) ||
        (row.primary_choice === 0 && RESOLVED_FAIL_STATES.includes(proposal.state as never))
      ) {
        current.matches += 1;
      }
      result.set(proposal.dao_id, current);
    }

    return result;
  }
}
