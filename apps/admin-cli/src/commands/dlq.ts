import { Command } from 'commander';
import { chDb, ConfirmationRepository, DaoSourceRepository, DlqRepository, pgDb } from '@libs/db';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';

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

        if (row.stage !== 'archive_confirmation_write') {
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
          const { ArchiveWriter, EventRepository, makeIngesterListener } = await import(
            '@sources/compound'
          );
          const daoSourceId = await resolveDaoSourceId(
            row.archive_source_type,
            row.archive_chain_id,
          );
          if (daoSourceId == null) {
            fail(format, ExitCode.RuntimeFailure, 'unable to resolve dao_source_id for DLQ row');
          }

          const payload = row.payload as {
            raw?: { topics?: string[]; data?: string };
            block_number?: string;
          };
          const raw = payload.raw;
          if (raw?.topics == null || raw.data == null || payload.block_number == null) {
            fail(format, ExitCode.RuntimeFailure, 'DLQ payload is missing raw log fields');
          }
          if (
            row.archive_tx_hash == null ||
            row.archive_log_index == null ||
            row.archive_block_hash == null ||
            row.archive_chain_id == null ||
            row.archive_source_type == null
          ) {
            fail(format, ExitCode.RuntimeFailure, 'DLQ row is missing archive tuple fields');
          }

          const archiveWriter = new ArchiveWriter({
            eventRepo: new EventRepository({ chDb }),
            confirmationRepo: new ConfirmationRepository(pgDb),
            dlqRepo: new DlqRepository(pgDb),
            logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
          });
          const listener = makeIngesterListener(
            {
              archiveWriter,
              context: {
                daoSourceId,
                sourceType: row.archive_source_type,
                chainId: row.archive_chain_id,
                sourceLabel: row.archive_source_type,
              },
              logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
              dlqRepo: new DlqRepository(pgDb),
            },
            { onWriteFailure: 'throw' },
          );

          await listener([
            {
              sourceType: row.archive_source_type,
              chainId: row.archive_chain_id,
              blockNumber: BigInt(payload.block_number),
              blockHash: row.archive_block_hash,
              txHash: row.archive_tx_hash,
              txIndex: 0,
              logIndex: row.archive_log_index,
              address: '0x0000000000000000000000000000000000000000',
              topics: raw.topics,
              data: raw.data,
            },
          ]);

          const resolved = await pgDb
            .transaction()
            .execute((trx) =>
              new DlqRepository(trx).markRetrySucceeded(
                dlqId,
                'archive_write replay succeeded',
                executorFromEnv(),
              ),
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

async function resolveDaoSourceId(
  sourceType: string | null,
  chainId: string | null,
): Promise<string | null> {
  if (sourceType == null || chainId == null) {
    return null;
  }
  const repo = new DaoSourceRepository(pgDb);
  const rows = await repo.findBySourceType(sourceType);
  const matching = rows.filter((row) => row.primary_chain_id === chainId);
  if (matching.length !== 1 || matching[0] == null) {
    return null;
  }
  return matching[0].id;
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
