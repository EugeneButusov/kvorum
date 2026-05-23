import { Command } from 'commander';
import { DlqRepository, pgDb } from '@libs/db';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';
import { DLQ_RETRY_ADAPTERS } from './dlq-retry/registry.js';
import { isDlqRetryableStage } from './dlq-retry-stage.js';

type DlqCommon = { format?: string };
type DlqListOptions = DlqCommon & { feature?: string; limit?: string };
type DlqRetryOptions = DlqCommon & { dryRun?: boolean };
type DlqAcceptOptions = DlqCommon & { reason: string };

export function registerDlq(program: Command): void {
  const dlq = program.command('dlq').description('Dead-letter queue management');

  dlq
    .command('list')
    .description('List DLQ entries')
    .option('--feature <name>', 'filter by feature name')
    .option('--limit <N>', 'maximum number of entries to return')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: DlqListOptions) {
      await withDlqFormat(this, opts, async (format) => {
        const { dlqRepository } = buildContainer();
        const limit = parseLimit(opts.limit);
        const rows = await dlqRepository.list({ source: opts.feature, limit });
        emit(
          format,
          () =>
            rows.length === 0
              ? 'No DLQ rows'
              : rows.map((r) => `${r.id} stage=${r.stage} source=${r.source}`).join('\n'),
          { count: rows.length, items: rows },
        );
      });
    });

  dlq
    .command('retry <dlq_id>')
    .description('Retry a DLQ entry')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(dlqId: string, opts: DlqRetryOptions) {
      await withDlqFormat(this, opts, async (format) => {
        const { dlqRepository } = buildContainer();
        const row = await dlqRepository.getById(dlqId);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dlq row not found: ${dlqId}`);
        }

        if (!isDlqRetryableStage(row.stage)) {
          emit(
            format,
            () =>
              'derive-stage DLQ entries are re-derived by the running indexer; use derive replay then verify',
            {
              dlq_id: dlqId,
              status: 'not_retryable_via_cli',
              stage: row.stage,
            },
          );
          return;
        }

        if (opts.dryRun === true) {
          emit(format, () => `Would retry DLQ row ${dlqId}`, { dlq_id: dlqId, dry_run: true });
          return;
        }

        await withAudit('dlq retry', { dlqId }, async () => {
          const adapter = DLQ_RETRY_ADAPTERS.get(row.stage);
          if (adapter == null) {
            fail(
              format,
              ExitCode.RuntimeFailure,
              `no retry adapter registered for stage ${row.stage}`,
            );
          }

          const outcome = await adapter.retry(row);
          const resolved = await pgDb
            .transaction()
            .execute((trx) =>
              new DlqRepository(trx).markRetrySucceeded(dlqId, outcome.reason, executorFromEnv()),
            );
          emit(format, () => `DLQ retry completed for ${dlqId}`, {
            dlq_id: dlqId,
            status: resolved,
          });
        });
      });
    });

  dlq
    .command('accept <dlq_id>')
    .description('Accept (discard) a DLQ entry with a recorded reason')
    .requiredOption('--reason <reason>', 'justification for accepting without retry')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(dlqId: string, opts: DlqAcceptOptions) {
      await withDlqFormat(this, opts, async (format) => {
        if (opts.reason.trim().length === 0) {
          fail(format, ExitCode.ValidationFailure, '--reason must not be empty');
        }
        await withAudit('dlq accept', { dlqId, reason: opts.reason }, async () => {
          const result = await pgDb
            .transaction()
            .execute((trx) =>
              new DlqRepository(trx).accept(dlqId, opts.reason.trim(), executorFromEnv()),
            );
          if (result === 'not_found') {
            fail(format, ExitCode.NotFound, `dlq row not found: ${dlqId}`);
          }
          if (result === 'already_resolved') {
            fail(format, ExitCode.RuntimeFailure, `dlq row already resolved: ${dlqId}`);
          }
          emit(format, () => `DLQ row accepted: ${dlqId}`, { dlq_id: dlqId, status: result });
        });
      });
    });
}

function parseLimit(value: string | undefined): number {
  if (value == null) {
    return 50;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error('--limit must be an unsigned integer');
  }
  const n = Number(value);
  if (n <= 0 || n > 500) {
    throw new Error('--limit must be between 1 and 500');
  }
  return n;
}

function executorFromEnv(): string {
  return process.env['SUDO_USER'] ?? process.env['USER'] ?? process.env['LOGNAME'] ?? 'unknown';
}

async function withDlqFormat(
  command: Command,
  opts: DlqCommon,
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
    if (
      message.startsWith('invalid --format value:') ||
      message.includes('unsigned integer') ||
      message.includes('between 1 and 500')
    ) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(format, ExitCode.RuntimeFailure, 'dlq command failed', { message });
  }
}
