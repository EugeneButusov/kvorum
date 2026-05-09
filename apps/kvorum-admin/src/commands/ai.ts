import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerAi(program: Command): void {
  const ai = program.command('ai').description('AI feature management');

  ai.command('disable <feature>')
    .description('Disable an AI feature')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_feature, opts) => emitNotImplemented('ai disable', opts));

  ai.command('enable <feature>')
    .description('Enable an AI feature')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_feature, opts) => emitNotImplemented('ai enable', opts));

  const cap = ai.command('cap').description('AI spending cap management');

  cap
    .command('set <feature> <usd>')
    .description('Set a USD spending cap for an AI feature')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_feature, _usd, opts) => emitNotImplemented('ai cap set', opts));

  ai.command('regenerate <feature> <entity_reference>')
    .description('Regenerate AI output for an entity')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_feature, _ref, opts) => emitNotImplemented('ai regenerate', opts));
}
