import { sql, type Kysely, type RawBuilder } from 'kysely';
import { ActorRoutingReadRepository, type MergeMapEntry } from './actor-routing-repository';
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

/**
 * Bucket start instants (UTC) covering [from, to] at the given grain, aligned to the natural period
 * boundary so labels match what ClickHouse's toStartOf* would produce.
 *
 * The grid is generated rather than read off the data on purpose: concentration is a standing
 * distribution, so a period with no delegation events still has a value to report. Deriving buckets
 * from event timestamps is what collapsed the chart to whichever months happened to contain events.
 */
export function bucketGrid(from: Date, to: Date, grain: BucketGrain): Date[] {
  if (to.getTime() < from.getTime()) return [];

  const start = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0),
  );
  if (grain === 'monthly') start.setUTCDate(1);
  if (grain === 'weekly') {
    // ClickHouse toStartOfWeek defaults to Sunday.
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  }

  const out: Date[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= to.getTime()) {
    out.push(new Date(cursor));
    if (grain === 'daily') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (grain === 'weekly') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

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
  /** The canonical address the peer was grouped by — the sort tiebreak, and so the cursor tiebreak. */
  peer_address: string;
  vote_count: number;
  shared_proposals: number;
  matched_choices: number;
};

export type DelegationFlowEdgeRow = {
  // Nullable: an address reaches the projection from chain events, and nothing guarantees the
  // derivation created an actor for it. The dictionary this replaced returned NULL in that case
  // too — the type simply did not say so.
  delegator_actor_id: string | null;
  delegate_actor_id: string | null;
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
  /**
   * Standing voting power delegated TO this actor in the DAO, as an exact decimal string — the
   * figure the delegate leaderboard ranks on. Not the actor's own token balance: the balance
   * projection was retired in M3, so delegation events are the only source.
   */
  current_voting_power: string;
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

/**
 * Delegating to address(0) is how ERC20Votes-style governors express *un*delegation — it is not a
 * delegate. It is also the only address in the entire production dataset with no actor row, so
 * excluding it from both a leaderboard's rows and its total is what makes the two consistent.
 */
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

/**
 * Max addresses per ClickHouse `IN (…)` list. A 42-char address plus quoting/comma is ~47 bytes, so
 * 2000 keeps the list near ~94 KB — comfortably under ClickHouse's 256 KiB `max_query_size` with
 * room for the rest of the statement. Larger callers chunk across several queries.
 */
const CH_IN_LIST_CHUNK = 2000;

export class AnalyticsReadRepository {
  private readonly identity: ActorRoutingReadRepository;

  constructor(
    private readonly chDb: Kysely<ClickHouseDatabase>,
    private readonly pgDb: Kysely<PgDatabase>,
  ) {
    this.identity = new ActorRoutingReadRepository(pgDb);
  }

  /**
   * Collapse a ClickHouse address column onto its actor's canonical address, so an aggregate can be
   * grouped by actor without ClickHouse knowing what an actor is (ADR-087).
   *
   * With no merged actors the map is empty and `transform` has nothing to rewrite, so this is the
   * identity — which is exactly what the `actor_address_redirect` dictionary it replaces computed,
   * at the cost of a live ClickHouse→Postgres connection. Unlike `dictGetOrNull(...)`, `transform`
   * over the sort-key column stays sargable, so the bloom filters and sort key still apply.
   */
  private canonicalAddress(column: string, mergeMap: readonly MergeMapEntry[]): RawBuilder<string> {
    const raw = sql<string>`toString(${sql.raw(column)})`;
    if (mergeMap.length === 0) return raw;
    const from = sql.join(mergeMap.map((entry) => sql`${entry.address}`));
    const to = sql.join(mergeMap.map((entry) => sql`${entry.canonicalAddress}`));
    return sql<string>`transform(${raw}, [${from}], [${to}], ${raw})`;
  }

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

  /**
   * Voting-power concentration per bucket (§6.7).
   *
   * Each bucket is the **standing distribution as of the end of that bucket**, not the delegation
   * events that happened inside it. Getting there takes three levels, and skipping any of them is
   * what made the published numbers wrong:
   *
   * 1. Per (bucket, delegator), the delegator's latest delegation at or before the bucket end
   *    (`argMax` by created_at). `delegation_flow_projection` is an event log — a delegator appears
   *    once per delegation event they ever made — so aggregating it directly counts each delegator
   *    once per event and sums their power repeatedly. That inflated Compound's total to ~2.39
   *    billion COMP against a 10 million supply (~240x), which in turn deflated every top-N share
   *    (top-10 read 0.6% where the real figure is tens of percent).
   * 2. Per (bucket, delegate), the sum of the power delegated to them. Concentration is a property
   *    of the delegates who hold voting power, so the weights must be per-delegate — the previous
   *    query never grouped by delegate at all, it just took raw event amounts.
   * 3. Per bucket, the weight vector the Gini / top-share math consumes.
   *
   * The bucket grid is passed in rather than derived from the data: a bucket must appear even when
   * no delegation happened in it (the distribution still stands), and deriving buckets from event
   * timestamps is why the chart collapsed to a single point.
   *
   * Deliberately dictionary-free: this aggregates by delegate address, not actor id. Addresses
   * merged into one actor therefore count separately, which is the existing behaviour and keeps the
   * one endpoint that carries no `dictGetOrNull` independent of the actor dictionary.
   */
  async concentrationByBucket(args: {
    daoId: string;
    from: Date;
    to: Date;
    bucket: BucketGrain;
  }): Promise<MirrorEnvelope<ConcentrationBucketRow>> {
    const bucketStarts = bucketGrid(args.from, args.to, args.bucket);
    if (bucketStarts.length === 0) return { rows: [], mirrorLastEtl: null };

    const bucketEnd = (expr: string) =>
      args.bucket === 'daily'
        ? sql`addDays(${sql.raw(expr)}, 1)`
        : args.bucket === 'weekly'
          ? sql`addWeeks(${sql.raw(expr)}, 1)`
          : sql`addMonths(${sql.raw(expr)}, 1)`;

    const grid = sql.join(bucketStarts.map((d) => sql`fromUnixTimestamp64Milli(${d.getTime()})`));

    // Standing state per (bucket, delegator): the latest delegation at or before the bucket end.
    const standingPerDelegator = sql`
      SELECT
        be.bucket AS bucket,
        dfa.delegator_address AS delegator_address,
        argMax(dfa.delegate_address, dfa.created_at) AS delegate_address,
        argMax(dfa.voting_power, dfa.created_at) AS vp
      FROM (SELECT arrayJoin([${grid}]) AS bucket) AS be
      CROSS JOIN delegation_flow_projection AS dfa
      WHERE dfa.dao_id = ${args.daoId}
        AND dfa.created_at <= fromUnixTimestamp64Milli(${args.to.getTime()})
        AND dfa.created_at < ${bucketEnd('be.bucket')}
      GROUP BY be.bucket, dfa.delegator_address
    `;

    // Collapse to power per delegate. The zero address is "undelegated", not a delegate.
    const perDelegate = sql`
      SELECT bucket, delegate_address, sum(vp) AS delegate_vp
      FROM (${standingPerDelegator})
      WHERE vp > 0 AND delegate_address != '0x0000000000000000000000000000000000000000'
      GROUP BY bucket, delegate_address
    `;

    // NB: must go through the query builder. A raw sql`...`.execute() against the ClickHouse
    // dialect silently resolves to zero rows instead of erroring.
    const rows = await this.chDb
      .selectFrom(
        sql<{ bucket: string; delegate_address: string; delegate_vp: string }>`(${perDelegate})`.as(
          'd',
        ),
      )
      .select([
        'd.bucket',
        // arrayMap(toString): each element is a UInt256 — without it the array comes back as JS
        // numbers on the production server and the Gini / top-share math silently computes from
        // precision-lossy values (BigInt(5.89e22) does not throw, it just rounds). Carried over
        // from #549, which applied the same treatment to the pre-rewrite query.
        sql<string[]>`arrayMap(x -> toString(x), arraySort(groupArray(d.delegate_vp)))`.as(
          'weights',
        ),
        sql<string>`toString(count())`.as('delegate_count'),
        sql<string>`toString(sum(d.delegate_vp))`.as('total_voting_power'),
      ])
      .groupBy('d.bucket')
      .orderBy('d.bucket', 'asc')
      .execute();

    const convertedRows: ConcentrationBucketRow[] = rows.map((row) => ({
      weights: row.weights,
      total_voting_power: row.total_voting_power,
      bucket: chTimestampToDate(row.bucket),
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
        // Identity is resolved in the service, not in ClickHouse: these are projected columns, so
        // there is nothing to group or filter by and the rows can simply be labelled after the fact.
        sql<string>`toString(dfa.delegator_address)`.as('delegator_address'),
        sql<string>`toString(dfa.delegate_address)`.as('delegate_address'),
        // Exact UInt256 as a decimal string — see the note on concentrationByBucket's weights.
        sql<string>`toString(dfa.voting_power)`.as('voting_power'),
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

    const rawRows = (await qb.execute()) as unknown as Array<{
      delegator_address: string;
      delegate_address: string;
      voting_power: string;
      block_number: string;
      event_type: string;
      created_at: string;
    }>;

    // One resolve for the whole page, over the distinct addresses on both ends of the edges.
    const actorIdByAddress = await this.identity.findCurrentActorIdsByAddresses([
      ...new Set(rawRows.flatMap((row) => [row.delegator_address, row.delegate_address])),
    ]);

    const rows: DelegationFlowEdgeRow[] = rawRows.map((row) => ({
      delegator_actor_id: actorIdByAddress.get(row.delegator_address) ?? null,
      delegate_actor_id: actorIdByAddress.get(row.delegate_address) ?? null,
      voting_power: row.voting_power,
      block_number: row.block_number,
      event_type: row.event_type,
      created_at: chTimestampToDate(row.created_at),
    }));
    const lastCreatedAt = rows[rows.length - 1]?.created_at ?? null;
    return { rows, mirrorLastEtl: lastCreatedAt };
  }

  /**
   * Each actor's current delegated-out voting power.
   *
   * Grouped by **address**, then folded per actor here. That split is not incidental: the standing
   * power of an actor holding several addresses is the sum of each address's latest delegation, and
   * `argMax(voting_power, created_at)` over an actor-wide group returns only whichever address moved
   * most recently — silently dropping the rest. Grouping by address makes each argMax mean "this
   * address's standing delegation", which is what summing requires (KNOWN-031).
   */
  async currentVotingPowerByActor(
    daoId: string,
    actorIds: readonly string[],
  ): Promise<ActorPowerRow[]> {
    if (actorIds.length === 0) return [];

    const addressRows = await this.pgDb
      .selectFrom('actor_address')
      .select(['address', 'actor_id'])
      .where('actor_id', 'in', [...actorIds])
      .execute();
    if (addressRows.length === 0) return [];
    const actorIdByAddress = new Map(addressRows.map((row) => [row.address, row.actor_id]));
    const addresses = [...actorIdByAddress.keys()];

    // Chunk the address IN-list. The delegation-flow endpoint calls this with every actor in the
    // graph — ~20k for Compound, so ~20k 42-char addresses — and a single IN-list blows past
    // ClickHouse's 256 KiB max_query_size, which surfaced as a 500 on that endpoint. Each chunk's
    // per-address argMax is independent (grouped by address), so folding the chunks is exact.
    const powerByActor = new Map<string, bigint>();
    for (let i = 0; i < addresses.length; i += CH_IN_LIST_CHUNK) {
      const chunk = addresses.slice(i, i + CH_IN_LIST_CHUNK);
      const rows = await this.chDb
        .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection`.as('dfa'))
        .select(sql<string>`toString(dfa.delegator_address)`.as('delegator_address'))
        // toString(): a bare UInt256 comes back as a JS number on a server with
        // output_format_json_quote_64bit_integers=0 (production), losing precision and stringifying
        // to exponential notation past 1e21 — see vote-read-repository.ts.
        .select(sql<string>`toString(argMax(dfa.voting_power, dfa.created_at))`.as('voting_power'))
        .where('dfa.dao_id', '=', daoId)
        // An address list, not a resolved-identity predicate: this filters on the sort-key column,
        // so it stays sargable where the dictionary lookup did not.
        .where(
          sql<boolean>`toString(dfa.delegator_address) in (${sql.join(
            chunk.map((address) => sql`${address}`),
          )})`,
        )
        .groupBy('delegator_address')
        .execute();

      for (const row of rows) {
        const actorId = actorIdByAddress.get(row.delegator_address);
        if (actorId === undefined) continue;
        powerByActor.set(actorId, (powerByActor.get(actorId) ?? 0n) + BigInt(row.voting_power));
      }
    }

    return [...powerByActor].map(([actor_id, power]) => ({
      actor_id,
      voting_power: power.toString(),
    }));
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
    type PerDelegator = { delegate_address: string; vp: string };
    const currentPerDelegator = sql<PerDelegator>`
      SELECT
        argMax(delegate_address, created_at) AS delegate_address,
        argMax(toUInt256(voting_power), created_at) AS vp
      FROM delegation_flow_projection
      WHERE dao_id = ${args.daoId}
      GROUP BY delegator_address
    `;

    // Merged actors must be summed BEFORE the top-N cut — top-N by address is not top-N by actor —
    // so the collapse happens inside ClickHouse, keeping the aggregate, the ranking and the LIMIT
    // there. The map is empty until someone merges actors, at which point this starts folding.
    const mergeMap = await this.identity.findMergeMap();
    const canonical = this.canonicalAddress('c.delegate_address', mergeMap);

    // Both reads MUST go through the query builder: a raw sql`...`.execute() against the ClickHouse
    // dialect silently resolves to zero rows instead of erroring, which returned an empty
    // leaderboard for every DAO.
    //
    // Both also apply the SAME two filters (power-bearing, and not the zero address), so the page
    // and the denominator describe one population and the shares sum to 1. They did not before: the
    // page dropped addresses the dictionary could not resolve while the total still counted them.
    const isRealDelegate = sql<boolean>`c.vp > 0 AND toString(c.delegate_address) != ${ZERO_ADDRESS}`;

    const leaderboard = await this.chDb
      .selectFrom(sql<PerDelegator>`(${currentPerDelegator})`.as('c'))
      .select([
        canonical.as('canonical_address'),
        sql<string>`toString(sum(c.vp))`.as('voting_power'),
        sql<string>`toString(count())`.as('delegator_count'),
      ])
      .where(isRealDelegate)
      .groupBy('canonical_address')
      .orderBy(sql`sum(c.vp)`, 'desc')
      // Tiebreak on the grouping key, which is now an address rather than an actor id.
      .orderBy('canonical_address', 'asc')
      .limit(args.limit)
      .execute();

    // Denominator for the share: every delegate, not just the returned page.
    const totalRow = await this.chDb
      .selectFrom(sql<PerDelegator>`(${currentPerDelegator})`.as('c'))
      .select(sql<string>`toString(sum(c.vp))`.as('total'))
      .where(isRealDelegate)
      .executeTakeFirst();

    // Bounded by page size: label the N canonical addresses the ranking returned.
    const actorIdByAddress = await this.identity.findCurrentActorIdsByAddresses(
      leaderboard.map((row) => row.canonical_address),
    );

    return {
      rows: leaderboard.flatMap((row) => {
        const actorId = actorIdByAddress.get(row.canonical_address) ?? null;
        // Every delegate address in production resolves once the zero address is excluded, so this
        // should never drop a row. If it ever does, the address reached the projection without the
        // derivation creating an actor for it — a gap upstream, not something to render blank.
        if (actorId === null) return [];
        return [
          {
            actor_id: actorId,
            voting_power: row.voting_power,
            delegator_count: Number(row.delegator_count),
          },
        ];
      }),
      totalVotingPower: totalRow?.total ?? '0',
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

    // The focal actor is identified by their address set; peers are grouped by canonical address so
    // a merged peer is one row rather than one per address. Both replace dictionary lookups that
    // could not use the sort key.
    const focalAddressRows = await this.pgDb
      .selectFrom('actor_address')
      .select('address')
      .where('actor_id', '=', args.focalActorId)
      .execute();
    const focalAddresses = focalAddressRows.map((row) => row.address);
    if (focalAddresses.length === 0) {
      return { rows: [], mirrorLastEtl: await this.findGlobalEtlWatermark() };
    }
    const mergeMap = await this.identity.findMergeMap();
    const peerCanonical = this.canonicalAddress('v2.voter_address', mergeMap);

    const rows = await this.chDb
      .with('focal', (db) => {
        let inner = db
          .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
          .select(['v.proposal_id', 'v.primary_choice'])
          .where('v.dao_id', '=', args.daoId)
          .where('v.voter_address', 'in', focalAddresses)
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
      .select(peerCanonical.as('peer_address'))
      .select(sql<number>`count(*)`.as('vote_count'))
      .select(sql<number>`count(*)`.as('shared_proposals'))
      .select(
        sql<number>`sum(if(v2.primary_choice = focal.primary_choice, 1, 0))`.as('matched_choices'),
      )
      .where('v2.dao_id', '=', args.daoId)
      .where('v2.superseded', '=', 0)
      // "Not the focal actor" is now "none of the focal actor's addresses".
      .where('v2.voter_address', 'not in', focalAddresses)
      .groupBy('peer_address')
      .orderBy(orderExpr, dir)
      // Tiebreak on the grouping key. It is an address now, not an actor id — the cursor payload
      // moves with it, so a cursor issued mid-page keeps pointing at the same peer.
      .orderBy('peer_address', dir)
      .limit(args.limit + 1)
      .execute();

    // Bounded by page size: label the peers this page returned.
    const actorIdByAddress = await this.identity.findCurrentActorIdsByAddresses(
      rows.map((row) => row.peer_address),
    );

    const mirrorLastEtl = await this.findGlobalEtlWatermark();
    return {
      rows: rows.flatMap((row) => {
        const peerActorId = actorIdByAddress.get(row.peer_address) ?? null;
        // A voter address with no actor cannot be rendered as a peer. Every voter address in
        // production resolves, so this drops nothing today.
        if (peerActorId === null) return [];
        return [
          {
            peer_actor_id: peerActorId,
            peer_address: row.peer_address,
            vote_count: Number(row.vote_count),
            shared_proposals: Number(row.shared_proposals),
            matched_choices: Number(row.matched_choices),
          },
        ];
      }),
      mirrorLastEtl,
    };
  }

  /**
   * Standing voting power delegated to a set of addresses, per DAO.
   *
   * Uses the same reduction as {@link delegateLeaderboard} — each delegator's latest delegation,
   * power-bearing only — so a delegate's scorecard figure and its leaderboard rank cannot disagree.
   * Filtering on the address set rather than a resolved actor id means a merged actor's addresses
   * are covered without a merge map: the caller already passes every address the actor owns.
   */
  private async receivedVotingPowerByDao(
    addresses: readonly string[],
  ): Promise<Map<string, string>> {
    if (addresses.length === 0) return new Map();

    type PerDelegator = { dao_id: string; delegate_address: string; vp: string };
    const currentPerDelegator = sql<PerDelegator>`
      SELECT
        dao_id,
        argMax(delegate_address, created_at) AS delegate_address,
        argMax(toUInt256(voting_power), created_at) AS vp
      FROM delegation_flow_projection
      GROUP BY dao_id, delegator_address
    `;

    const rows = await this.chDb
      .selectFrom(sql<PerDelegator>`(${currentPerDelegator})`.as('c'))
      .select(['c.dao_id', sql<string>`toString(sum(c.vp))`.as('voting_power')])
      .where(sql<boolean>`c.vp > 0`)
      .where(
        sql<boolean>`toString(c.delegate_address) in (${sql.join(
          addresses.map((address) => sql`${address}`),
        )})`,
      )
      .groupBy('c.dao_id')
      .execute();

    return new Map(rows.map((row) => [row.dao_id, row.voting_power]));
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

    // The rows are already filtered to this actor's own addresses, so resolving identity per row
    // only recomputed a constant we were given. Grouping by that recomputed value is what produced
    // the duplicate-DAO defect: a stale dictionary answered differently for two addresses of the
    // same actor, splitting one DAO into two rows and halving votes_cast and last_active_at.
    const chRows = await this.chDb
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select('v.dao_id')
      .select(sql<number>`count(*)`.as('votes_cast'))
      .select((eb) => eb.fn.max('v.cast_at').as('last_active_at'))
      .where('v.voter_address', 'in', addresses)
      .where('v.superseded', '=', 0)
      .groupBy('v.dao_id')
      .execute();

    // Power delegated TO the actor, per DAO. Read separately because it comes from a different
    // projection: an actor can hold power in a DAO it has never voted in — a pure delegate — and a
    // vote-derived summary alone would report it as absent rather than as silent.
    const powerByDaoId = await this.receivedVotingPowerByDao(addresses);

    const daoIds = [...new Set([...chRows.map((row) => row.dao_id), ...powerByDaoId.keys()])];
    const daos =
      daoIds.length === 0
        ? []
        : await this.pgDb
            .selectFrom('dao')
            .select(['id', 'slug'])
            .where('id', 'in', daoIds)
            .execute();
    const daoSlugById = new Map(daos.map((dao) => [dao.id, dao.slug]));
    const voteRowByDaoId = new Map(chRows.map((row) => [row.dao_id, row]));

    const rows: CrossDaoSummaryRow[] = daoIds.map((daoId) => {
      const voteRow = voteRowByDaoId.get(daoId);
      return {
        dao_id: daoId,
        dao_slug: daoSlugById.get(daoId) ?? '',
        // The caller asked about this actor; every row is theirs by construction.
        voter_actor_id: actorId,
        votes_cast: Number(voteRow?.votes_cast ?? 0),
        last_active_at:
          voteRow?.last_active_at != null
            ? chTimestampToDate(voteRow.last_active_at as unknown as string)
            : null,
        current_voting_power: powerByDaoId.get(daoId) ?? '0',
      };
    });

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

    // "Votes cast by this actor" is "votes cast from any address this actor owns" — expressed as an
    // address list rather than a resolved-identity predicate, so it filters on the sort-key column
    // and stays sargable. Reading the addresses from Postgres also removes the window in which a
    // stale dictionary disagreed about who owns them.
    const addressRows = await this.pgDb
      .selectFrom('actor_address')
      .select('address')
      .where('actor_id', '=', actorId)
      .execute();
    if (addressRows.length === 0) return new Map();

    const proposalById = new Map(proposals.map((row) => [row.id, row]));
    const voteRows = await this.chDb
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select(['v.proposal_id', 'v.primary_choice'])
      .where('v.superseded', '=', 0)
      .where(
        'v.voter_address',
        'in',
        addressRows.map((row) => row.address),
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
