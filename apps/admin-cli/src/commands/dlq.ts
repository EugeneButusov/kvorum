import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerDlq(program: Command): void {
  const dlq = program.command('dlq').description('Dead-letter queue management');

  dlq
    .command('list')
    .description('List DLQ entries')
    .option('--feature <name>', 'filter by feature name')
    .option('--limit <N>', 'maximum number of entries to return')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('dlq list', opts));

  dlq
    .command('retry <dlq_id>')
    .description('Retry a DLQ entry')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('dlq retry', opts));

  // --reason is required per ADR-032: accept semantics require an explicit justification
  dlq
    .command('accept <dlq_id>')
    .description('Accept (discard) a DLQ entry with a recorded reason')
    .requiredOption('--reason <reason>', 'justification for accepting without retry')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('dlq accept', opts));
}
