import { Command } from 'commander';
import { buildContainer } from '../bootstrap.js';
import {
  emit,
  emitNotImplemented,
  ExitCode,
  fail,
  type OutputFormat,
  resolveFormat,
} from '../output.js';

type BackfillCommonOptions = {
  format?: string;
};

type BackfillCancelOptions = BackfillCommonOptions & {
  dryRun?: boolean;
};

export function registerBackfill(program: Command): void {
  const backfill = program.command('backfill').description('Backfill management');

  backfill
    .command('start <dao_source_id>')
    .description('Start a backfill for a DAO source')
    .option('--from-block <N>', 'starting block number')
    .option('--to-block <N>', 'ending block number')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('backfill start', opts));

  backfill
    .command('status <dao_source_id>')
    .description('Show backfill status for a DAO source')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: BackfillCommonOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const { daoSourceRepository } = buildContainer();
        const row = await daoSourceRepository.readBackfillStatus(daoSourceId);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
        }

        const payload = {
          dao_source_id: row.id,
          in_progress: row.backfill_started_at_block !== null,
          backfill_started_at_block: row.backfill_started_at_block,
          backfill_head_block: row.backfill_head_block,
          cancel_requested_at: row.backfill_cancel_requested_at?.toISOString() ?? null,
        };

        emit(
          format,
          () =>
            [
              `DAO source: ${payload.dao_source_id}`,
              `In progress: ${payload.in_progress ? 'yes' : 'no'}`,
              `Started-at block: ${payload.backfill_started_at_block ?? 'n/a'}`,
              `Head block: ${payload.backfill_head_block ?? 'n/a'}`,
              `Cancel requested at: ${payload.cancel_requested_at ?? 'n/a'}`,
            ].join('\n'),
          payload,
        );
      });
    });

  backfill
    .command('cancel <dao_source_id>')
    .description('Cancel an in-progress backfill')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: BackfillCancelOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const { daoSourceRepository } = buildContainer();
        const status = await daoSourceRepository.readBackfillStatus(daoSourceId);
        if (status == null) {
          fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
        }
        if (status.backfill_started_at_block == null) {
          fail(format, ExitCode.ValidationFailure, 'backfill is not in progress');
        }

        if (opts.dryRun === true) {
          emit(
            format,
            () => `Would request cancellation for in-progress backfill on ${daoSourceId}`,
            { dao_source_id: daoSourceId, dry_run: true, action: 'request_cancel' },
          );
          return;
        }

        await daoSourceRepository.requestCancel(daoSourceId);
        emit(format, () => `Cancellation requested for in-progress backfill on ${daoSourceId}`, {
          dao_source_id: daoSourceId,
          cancel_requested: true,
        });
      });
    });
}

async function withBackfillFormat(
  command: Command,
  opts: BackfillCommonOptions,
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
    if (message.startsWith('invalid --format value:')) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(format, ExitCode.RuntimeFailure, 'backfill command failed', { message });
  }
}
