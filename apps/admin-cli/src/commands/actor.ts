import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerActor(program: Command): void {
  const actor = program.command('actors').description('Actor management');

  actor
    .command('merge <primary_actor_id> <secondary_actor_id>')
    .description('Merge two actor identities (destructive)')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_primary, _secondary, opts) => emitNotImplemented('actors merge', opts));

  const address = actor.command('address').description('Actor address management');

  address
    .command('add <actor_id> <address>')
    .description('Add an address to an actor')
    .requiredOption('--source <source>', 'address source')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_actor_id, _address, opts) => emitNotImplemented('actors address add', opts));
}
