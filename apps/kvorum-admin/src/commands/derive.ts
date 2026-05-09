import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerDerive(program: Command): void {
  const derive = program.command('derive').description('Derived data management');

  derive
    .command('replay <dao_source_id>')
    .description('Replay derivation for a DAO source (destructive)')
    .option('--from-block <N>', 'starting block number')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('derive replay', opts));

  derive
    .command('verify <proposal_external_id>')
    .description('Verify derived data for a proposal')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('derive verify', opts));
}
