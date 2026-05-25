import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { ClickHouseDatabase, PgDatabase } from '@libs/db';
import type { BucketGrain } from './bucket';
import { pgTimeBucketExpression } from './bucket';

type VoteEventsAnalyticsTable = {
  dao_id: string;
  created_at: Date;
};

type DelegationFlowAnalyticsTable = {
  dao_id: string;
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

export class AnalyticsReadRepository {
  constructor(
    private readonly chDb: Kysely<AnalyticsClickHouseDatabase>,
    private readonly pgDb: Kysely<PgDatabase>,
  ) {}

  async findEarliestDelegationEventAt(daoId: string): Promise<Date | null> {
    const row = await this.chDb
      .selectFrom('delegation_flow_analytics')
      .select((eb) => eb.fn.min('created_at').as('earliest'))
      .where('dao_id', '=', daoId)
      .executeTakeFirst();
    return row?.earliest ?? null;
  }

  async findGlobalEtlWatermark(): Promise<Date | null> {
    const row = await this.chDb
      .selectFrom('vote_events_analytics')
      .select((eb) => eb.fn.max('created_at').as('watermark'))
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

    if (args.from !== undefined) {
      qb = qb.where('proposal.created_at', '>=', args.from);
    }
    if (args.to !== undefined) {
      qb = qb.where('proposal.created_at', '<=', args.to);
    }
    if (args.proposalType !== undefined) {
      qb = qb.where('proposal.source_type', '=', args.proposalType);
    }

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
}
