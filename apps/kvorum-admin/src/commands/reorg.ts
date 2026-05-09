import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerReorg(program: Command): void {
  const reorg = program.command('reorg').description('Chain reorg management');

  reorg
    .command('list')
    .description('List detected chain reorgs')
    .option('--chain <id>', 'filter by chain ID')
    .option('--since <iso>', 'filter by ISO timestamp')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('reorg list', opts));
}
