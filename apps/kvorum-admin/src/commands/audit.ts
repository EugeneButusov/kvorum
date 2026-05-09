import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerAudit(program: Command): void {
  const audit = program.command('audit').description('Audit log access');

  audit
    .command('list')
    .description('List audit log entries')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('audit list', opts));
}
