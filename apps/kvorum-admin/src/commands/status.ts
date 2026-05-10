import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show system status')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('status', opts));
}
