import { Command } from 'commander';
import { buildContainer } from '../bootstrap.js';
import { StatusHandler } from '../handlers/status-handler.js';
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
        const { systemStatusRepository } = buildContainer();
        const handler = new StatusHandler(systemStatusRepository);
        const payload = await handler.get();

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
