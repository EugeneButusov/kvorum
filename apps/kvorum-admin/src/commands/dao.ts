import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerDao(program: Command): void {
  const dao = program.command('dao').description('DAO management');

  dao
    .command('add <slug>')
    .description('Register a new DAO')
    .requiredOption('--name <name>', 'display name')
    .requiredOption('--token <address>', 'governance token address')
    .requiredOption('--chain <id>', 'chain ID')
    .option('--format <format>', 'output format: human or json')
    .action((_slug, opts) => emitNotImplemented('dao add', opts));

  const source = dao.command('source').description('DAO source management');

  source
    .command('add <dao_slug>')
    .description('Add a data source to a DAO')
    .requiredOption('--type <type>', 'source type')
    .requiredOption('--config <json>', 'source configuration JSON')
    .option('--format <format>', 'output format: human or json')
    .action((_dao_slug, opts) => emitNotImplemented('dao source add', opts));

  source
    .command('update <dao_source_id>')
    .description('Update a DAO source configuration')
    .requiredOption('--config <json>', 'updated configuration JSON')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('dao source update', opts));

  source
    .command('delete <dao_source_id>')
    .description('Delete a DAO source (destructive)')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('dao source delete', opts));
}
