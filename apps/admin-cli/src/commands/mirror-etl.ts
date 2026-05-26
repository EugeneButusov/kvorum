import { Command } from 'commander';
import { MirrorEtlRunRepository, MirrorEtlWatermarkRepository, pgDb } from '@libs/db';
import { withAudit } from '../audit.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';
import { MirrorEtlCliRunner, type MirrorEtlJobName } from './mirror-etl-runner.js';

type MirrorEtlCommon = { format?: string };
type RunNowOpts = MirrorEtlCommon & { job?: string };
type ResetWatermarkOpts = MirrorEtlCommon & { job: string; to: string; confirm?: boolean };

const EPOCH = new Date('1970-01-01T00:00:00.000Z');

export function registerMirrorEtl(program: Command): void {
  const mirror = program.command('mirror-etl').description('Mirror ETL operations');

  mirror
    .command('run-now')
    .description('Run mirror ETL immediately')
    .option('--job <name>', 'vote_events_etl | delegation_flow_etl | all', 'all')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: RunNowOpts) {
      await withMirrorFormat(this, opts, async (format) => {
        const job = parseJobName(opts.job);
        const runner = new MirrorEtlCliRunner();

        await withAudit('mirror-etl run-now', { job }, async () => {
          if (job === 'all') {
            const results = await Promise.allSettled([
              runner.runJob('vote_events_etl'),
              runner.runJob('delegation_flow_etl'),
            ]);
            const payload = {
              vote_events_etl: results[0],
              delegation_flow_etl: results[1],
            };

            const hasFailure = results.some(
              (result) =>
                result.status === 'rejected' ||
                (result.status === 'fulfilled' && result.value.outcome !== 'completed'),
            );

            emit(format, () => JSON.stringify(payload, null, 2), payload);
            if (hasFailure) {
              fail(format, ExitCode.RuntimeFailure, 'one or more mirror-etl jobs did not complete');
            }
            return;
          }

          const result = await runner.runJob(job);
          emit(format, () => `mirror-etl ${job} outcome=${result.outcome}`, {
            job,
            ...result,
          });
          if (result.outcome !== 'completed') {
            fail(format, ExitCode.RuntimeFailure, `mirror-etl ${job} failed`, { result });
          }
        });
      });
    });

  mirror
    .command('status')
    .description('Show mirror ETL watermark and last successful run status')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: MirrorEtlCommon) {
      await withMirrorFormat(this, opts, async (format) => {
        const watermarkRepo = new MirrorEtlWatermarkRepository(pgDb);
        const runRepo = new MirrorEtlRunRepository(pgDb);
        const jobs: MirrorEtlJobName[] = ['vote_events_etl', 'delegation_flow_etl'];

        const rows = await Promise.all(
          jobs.map(async (jobName) => {
            const [watermark, lastRun] = await Promise.all([
              watermarkRepo.findByName(jobName),
              runRepo.findLastSuccess(jobName),
            ]);

            const ageSeconds =
              lastRun?.completed_at == null
                ? null
                : Math.floor((Date.now() - lastRun.completed_at.getTime()) / 1000);

            return {
              job_name: jobName,
              watermark: watermark?.toISOString() ?? null,
              last_run_completed_at: lastRun?.completed_at?.toISOString() ?? null,
              last_run_exact_match: lastRun?.exact_match ?? null,
              last_run_rows_written: lastRun?.rows_written ?? null,
              age_seconds: ageSeconds,
            };
          }),
        );

        emit(
          format,
          () =>
            rows
              .map(
                (row) =>
                  `${row.job_name} watermark=${row.watermark ?? 'n/a'} ` +
                  `last_completed=${row.last_run_completed_at ?? 'never'} ` +
                  `exact_match=${row.last_run_exact_match ?? 'n/a'} rows=${row.last_run_rows_written ?? 'n/a'} ` +
                  `age_seconds=${row.age_seconds ?? 'n/a'}`,
              )
              .join('\n'),
          { jobs: rows },
        );
      });
    });

  mirror
    .command('reset-watermark')
    .description('Reset ETL watermark for a mirror job')
    .requiredOption('--job <name>', 'vote_events_etl | delegation_flow_etl')
    .requiredOption('--to <value>', 'epoch or ISO-8601 timestamp')
    .option('--confirm', 'confirm mutation')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: ResetWatermarkOpts) {
      await withMirrorFormat(this, opts, async (format) => {
        if (opts.confirm !== true) {
          fail(format, ExitCode.ValidationFailure, '--confirm is required');
        }

        const job = parseSingleJobName(opts.job);
        const watermark = parseWatermark(opts.to);
        const watermarkRepo = new MirrorEtlWatermarkRepository(pgDb);

        await withAudit(
          'mirror-etl reset-watermark',
          { job, to: watermark.toISOString() },
          async () => {
            await watermarkRepo.resetTo(job, watermark);
            emit(format, () => `watermark reset for ${job} to ${watermark.toISOString()}`, {
              job,
              watermark: watermark.toISOString(),
            });
          },
        );
      });
    });
}

function parseJobName(raw: string | undefined): MirrorEtlJobName | 'all' {
  if (raw == null || raw === 'all') return 'all';
  if (raw === 'vote_events_etl' || raw === 'delegation_flow_etl') return raw;
  throw new Error('--job must be one of: vote_events_etl, delegation_flow_etl, all');
}

function parseSingleJobName(raw: string): MirrorEtlJobName {
  if (raw === 'vote_events_etl' || raw === 'delegation_flow_etl') return raw;
  throw new Error('--job must be one of: vote_events_etl, delegation_flow_etl');
}

function parseWatermark(raw: string): Date {
  if (raw === 'epoch') {
    return EPOCH;
  }

  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new Error('--to must be epoch or a valid ISO-8601 timestamp');
  }

  return value;
}

async function withMirrorFormat(
  command: Command,
  opts: MirrorEtlCommon,
  run: (format: OutputFormat) => Promise<void>,
): Promise<void> {
  let format: OutputFormat = 'human';
  try {
    const globalFormat = command.optsWithGlobals()['format'];
    format = resolveFormat(
      opts.format,
      typeof globalFormat === 'string' ? globalFormat : undefined,
    );
    await run(format);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (message.startsWith('invalid --format value:') || message.startsWith('--')) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(format, ExitCode.RuntimeFailure, 'mirror-etl command failed', { message });
  }
}
