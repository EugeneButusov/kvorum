import { Command } from 'commander';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';

type AuditListOptions = { format?: string };

export function registerAudit(program: Command): void {
  const audit = program.command('audit').description('Audit log access');

  audit
    .command('list')
    .description('List audit log entries')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: AuditListOptions) {
      await withAuditFormat(this, opts, async (format) => {
        const { adminAuditRepository } = buildContainer();
        const rows = await adminAuditRepository.listRecent(100);
        emit(
          format,
          () =>
            rows.length === 0
              ? 'No audit rows'
              : rows
                  .map(
                    (r) =>
                      `${r.started_at.toISOString()} ${r.command} ${r.outcome ?? 'in_progress'} executor=${r.executor}`,
                  )
                  .join('\n'),
          {
            count: rows.length,
            items: rows.map((r) => ({
              id: r.id,
              command: r.command,
              executor: r.executor,
              executor_kind: r.executor_kind,
              started_at: r.started_at.toISOString(),
              completed_at: r.completed_at?.toISOString() ?? null,
              outcome: r.outcome,
              args: r.args,
              error: r.error,
            })),
          },
        );
      });
    });
}

async function withAuditFormat(
  command: Command,
  opts: AuditListOptions,
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
    fail(format, ExitCode.RuntimeFailure, 'audit command failed', { message });
  }
}
