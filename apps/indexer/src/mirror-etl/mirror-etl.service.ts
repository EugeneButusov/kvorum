import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Kysely, sql, type Transaction } from 'kysely';
import {
  ADVISORY_LOCK_NAMESPACE_MIRROR_ETL,
  DlqRepository,
  MirrorEtlRunRepository,
  MirrorEtlWatermarkRepository,
  type ClickHouseDatabase,
  type PgDatabase,
} from '@libs/db';
import { mirrorEtlMetrics } from './mirror-etl-metrics';
import { streamDelegationRowsForEtl, streamVoteRowsForEtl } from './mirror-etl-readers';

const MIRROR_ETL_CRON = process.env['MIRROR_ETL_CRON'] ?? '0 4 * * *';
const CONSISTENCY_PRUNE_DAYS = 7;

type MirrorEtlJobName = 'vote_events_etl' | 'delegation_flow_etl';

interface MirrorEtlServiceOptions {
  batchSize: number;
  dlqThreshold: number;
  overlapHours: number;
}

type RunOutcome =
  | { outcome: 'skipped_locked' }
  | { outcome: 'completed'; rowsWritten: number; exactMatch: boolean; driftRatio: number }
  | { outcome: 'error'; error: string };

@Injectable()
export class MirrorEtlService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MirrorEtlService');
  private gaugePollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly pg: Kysely<PgDatabase>,
    private readonly ch: Kysely<ClickHouseDatabase>,
    private readonly watermarks: MirrorEtlWatermarkRepository,
    private readonly runs: MirrorEtlRunRepository,
    private readonly dlq: DlqRepository,
    private readonly opts: MirrorEtlServiceOptions,
  ) {}

  onApplicationBootstrap(): void {
    this.gaugePollHandle = setInterval(() => {
      void this.refreshLastSuccessGauges();
    }, 60_000);
  }

  onApplicationShutdown(): void {
    if (this.gaugePollHandle != null) {
      clearInterval(this.gaugePollHandle);
      this.gaugePollHandle = null;
    }
  }

  @Cron(MIRROR_ETL_CRON)
  async tick(): Promise<void> {
    await Promise.allSettled([this.runJob('vote_events_etl'), this.runJob('delegation_flow_etl')]);
  }

  async runJob(jobName: MirrorEtlJobName): Promise<RunOutcome> {
    const watermarkFrom = await this.watermarks.findByName(jobName);
    if (watermarkFrom == null) {
      throw new Error(`missing etl watermark row for job ${jobName}`);
    }

    const watermarkTo = new Date();
    const startedAt = Date.now();
    let attemptCount = 0;

    try {
      const startOutcome = await this.pg.transaction().execute(async (trx) => {
        const locked = await this.tryAcquireAdvisoryLock(trx, jobName);
        if (!locked) {
          mirrorEtlMetrics.skipped.add(1, { reason: 'locked' });
          return { outcome: 'skipped_locked' as const };
        }

        const result = await new MirrorEtlRunRepository(trx).startCycle({
          job_name: jobName,
          watermark_from: watermarkFrom,
          watermark_to: watermarkTo,
        });
        attemptCount = result.attempt_count;
        return { outcome: 'started' as const };
      });

      if (startOutcome.outcome === 'skipped_locked') {
        return startOutcome;
      }

      const rowsWritten = await this.copyBatched(jobName, watermarkFrom, watermarkTo);
      const { exactMatch, driftRatio } = await this.consistencyGate(jobName, watermarkTo);

      await this.pg.transaction().execute(async (trx) => {
        const runRepo = new MirrorEtlRunRepository(trx);
        const watermarkRepo = new MirrorEtlWatermarkRepository(trx);
        await runRepo.markCompleted(jobName, watermarkFrom, {
          rows_written: rowsWritten,
          exact_match: exactMatch,
          drift_ratio: driftRatio,
          completed_at: new Date(),
        });
        await watermarkRepo.advance(jobName, watermarkTo);
      });

      mirrorEtlMetrics.attempts.add(1, { job: jobName, outcome: 'completed' });
      mirrorEtlMetrics.rowsWritten.add(rowsWritten, { job: jobName });
      mirrorEtlMetrics.exactMatch.record(exactMatch ? 1 : 0, { job: jobName });
      mirrorEtlMetrics.driftRatio.record(driftRatio, { job: jobName });

      return { outcome: 'completed', rowsWritten, exactMatch, driftRatio };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('mirror_etl_cycle_failed', { jobName, error: message });

      await this.pg
        .transaction()
        .execute((trx) =>
          new MirrorEtlRunRepository(trx).markFailed(jobName, watermarkFrom, message),
        );

      if (attemptCount >= this.opts.dlqThreshold) {
        await this.dlq.insert({
          stage: 'mirror_etl_run',
          source: 'indexer.mirror-etl',
          payload: {
            job_name: jobName,
            watermark_from: watermarkFrom.toISOString(),
            watermark_to: watermarkTo.toISOString(),
          },
          error: { message },
          retries: attemptCount,
          first_seen_at: new Date(),
          last_attempt_at: new Date(),
          archive_source_type: null,
          archive_chain_id: null,
          archive_tx_hash: null,
          archive_log_index: null,
          archive_block_hash: null,
        });
      }

      mirrorEtlMetrics.attempts.add(1, { job: jobName, outcome: 'error' });
      return { outcome: 'error', error: message };
    } finally {
      mirrorEtlMetrics.durationSeconds.record((Date.now() - startedAt) / 1000, { job: jobName });
    }
  }

  private async tryAcquireAdvisoryLock(
    trx: Transaction<PgDatabase>,
    jobName: MirrorEtlJobName,
  ): Promise<boolean> {
    const lockResult = await sql<{ acquired: boolean }>`
      SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE_MIRROR_ETL}, hashtext(${jobName})) AS acquired
    `.execute(trx);

    return lockResult.rows[0]?.acquired === true;
  }

  private async copyBatched(
    jobName: MirrorEtlJobName,
    watermarkFrom: Date,
    watermarkTo: Date,
  ): Promise<number> {
    let total = 0;
    const streamOpts = {
      fromExclusive: watermarkFrom,
      toInclusive: watermarkTo,
      batchSize: this.opts.batchSize,
      overlapHours: this.opts.overlapHours,
    };

    if (jobName === 'vote_events_etl') {
      for await (const batch of streamVoteRowsForEtl(this.pg, streamOpts)) {
        total += batch.length;
        await this.ch.insertInto('vote_events_analytics').values(batch).execute();
      }
      return total;
    }

    for await (const batch of streamDelegationRowsForEtl(this.pg, streamOpts)) {
      total += batch.length;
      await this.ch.insertInto('delegation_flow_analytics').values(batch).execute();
    }
    return total;
  }

  private async consistencyGate(
    jobName: MirrorEtlJobName,
    watermarkTo: Date,
  ): Promise<{ exactMatch: boolean; driftRatio: number }> {
    const upperBound = new Date(watermarkTo.getTime() - this.opts.overlapHours * 60 * 60 * 1000);
    const pruneLowerBound = new Date(
      watermarkTo.getTime() - CONSISTENCY_PRUNE_DAYS * 24 * 60 * 60 * 1000,
    );

    const pgCount =
      jobName === 'vote_events_etl'
        ? await this.countPgVotes(upperBound)
        : await this.countPgDelegations(upperBound);

    const chCount =
      jobName === 'vote_events_etl'
        ? await this.countChVotes(upperBound, pruneLowerBound)
        : await this.countChDelegations(upperBound, pruneLowerBound);

    const exactMatch = pgCount === chCount;
    const driftRatio = Math.abs(pgCount - chCount) / Math.max(pgCount, 1);
    return { exactMatch, driftRatio };
  }

  private async countPgVotes(upperBound: Date): Promise<number> {
    const row = await this.pg
      .selectFrom('vote as v')
      .innerJoin('proposal as p', 'p.id', 'v.proposal_id')
      .select(({ fn }) => [fn.countAll<number>().as('count')])
      .where('v.created_at', '<=', upperBound)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async countPgDelegations(upperBound: Date): Promise<number> {
    const row = await this.pg
      .selectFrom('delegation')
      .select(({ fn }) => [fn.countAll<number>().as('count')])
      .where('created_at', '<=', upperBound)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async countChVotes(upperBound: Date, pruneLowerBound: Date): Promise<number> {
    const result = await sql<{ count: string }>`
      SELECT uniqExact(dao_id, proposal_id, voter_actor_id, vote_id) AS count
      FROM vote_events_analytics
      WHERE created_at <= ${upperBound}
        AND cast_at >= ${pruneLowerBound}
    `.execute(this.ch);

    return Number(result.rows[0]?.count ?? '0');
  }

  private async countChDelegations(upperBound: Date, pruneLowerBound: Date): Promise<number> {
    const result = await sql<{ count: string }>`
      SELECT uniqExact(dao_id, delegator_actor_id, block_number, delegation_id) AS count
      FROM delegation_flow_analytics
      WHERE created_at <= ${upperBound}
        AND created_at >= ${pruneLowerBound}
    `.execute(this.ch);

    return Number(result.rows[0]?.count ?? '0');
  }

  private async refreshLastSuccessGauges(): Promise<void> {
    const jobs: MirrorEtlJobName[] = ['vote_events_etl', 'delegation_flow_etl'];
    for (const job of jobs) {
      const row = await this.runs.findLastSuccess(job);
      const completedAt = row?.completed_at;
      const ageSeconds =
        completedAt == null
          ? Number.POSITIVE_INFINITY
          : (Date.now() - completedAt.getTime()) / 1000;
      mirrorEtlMetrics.lastSuccessAge.record(ageSeconds, { job });
    }
  }
}

export type { MirrorEtlJobName, MirrorEtlServiceOptions, RunOutcome };
