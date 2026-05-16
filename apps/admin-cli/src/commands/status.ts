import { Command } from 'commander';
import { pgDb } from '@libs/db';
import { emit, ExitCode, fail, resolveFormat, type OutputFormat } from '../output.js';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show system status')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: { format?: string }) {
      let format: OutputFormat = 'human';
      try {
        const globalFormat = this.optsWithGlobals()['format'];
        format = resolveFormat(
          opts.format,
          typeof globalFormat === 'string' ? globalFormat : undefined,
        );
        const [dlqRow, reorgRow, archiveRow, activeBackfills] = await Promise.all([
          pgDb
            .selectFrom('ingestion_dlq')
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow(),
          pgDb
            .selectFrom('reorg_event')
            .select((eb) => eb.fn.max('detected_at').as('last_detected_at'))
            .executeTakeFirstOrThrow(),
          pgDb
            .selectFrom('archive_confirmation')
            .select((eb) => eb.fn.max('received_at').as('last_received_at'))
            .executeTakeFirstOrThrow(),
          pgDb
            .selectFrom('dao_source')
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .where('backfill_started_at_block', 'is not', null)
            .executeTakeFirstOrThrow(),
        ]);

        const now = Date.now();
        const lastArchivedEventAt = archiveRow.last_received_at;
        const ingestionIdleForSeconds =
          lastArchivedEventAt == null
            ? null
            : Math.max(0, Math.floor((now - lastArchivedEventAt.getTime()) / 1000));

        const payload = {
          active_backfills: Number(activeBackfills.count),
          dlq_size: Number(dlqRow.count),
          last_reorg_detected_at: reorgRow.last_detected_at?.toISOString() ?? null,
          last_archived_event_at: lastArchivedEventAt?.toISOString() ?? null,
          ingestion_idle_for_seconds: ingestionIdleForSeconds,
        };

        emit(
          format,
          () =>
            [
              `DLQ size: ${payload.dlq_size}`,
              `Active backfills: ${payload.active_backfills}`,
              `Last reorg detected at: ${payload.last_reorg_detected_at ?? 'n/a'}`,
              `Last archived event at: ${payload.last_archived_event_at ?? 'n/a'}`,
              `Ingestion idle for: ${payload.ingestion_idle_for_seconds ?? 'n/a'}s`,
            ].join('\n'),
          payload,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        if (message.startsWith('invalid --format value:')) {
          fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
        }
        fail(format, ExitCode.RuntimeFailure, 'status command failed', { message });
      }
    });
}
