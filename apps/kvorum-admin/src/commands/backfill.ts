import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

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
    .action((_id, opts) => emitNotImplemented('backfill status', opts));

  backfill
    .command('cancel <dao_source_id>')
    .description('Cancel an in-progress backfill')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('backfill cancel', opts));
}
