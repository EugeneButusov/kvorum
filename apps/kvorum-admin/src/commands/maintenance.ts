import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerMaintenance(program: Command): void {
  const maintenance = program.command('maintenance').description('Maintenance mode management');

  maintenance
    .command('enable')
    .description('Enable maintenance mode')
    .requiredOption('--until <iso>', 'maintenance end time (ISO 8601)')
    .requiredOption('--message <text>', 'message shown to users')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('maintenance enable', opts));

  maintenance
    .command('disable')
    .description('Disable maintenance mode')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('maintenance disable', opts));
}
