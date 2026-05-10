import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerUser(program: Command): void {
  const user = program.command('user').description('User management');

  user
    .command('list')
    .description('List users')
    .option('--filter <expr>', 'filter expression')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('user list', opts));

  user
    .command('ban <user_id>')
    .description('Ban a user (destructive)')
    .requiredOption('--reason <reason>', 'reason for the ban')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('user ban', opts));

  user
    .command('delete <user_id>')
    .description('Delete a user account (destructive)')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('user delete', opts));

  user
    .command('create')
    .description('Create a new user account')
    .requiredOption('--email <email>', 'account email address (must be unique)')
    .requiredOption('--name <name>', 'display name')
    .option('--role <role>', 'account role: user or admin', 'user')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('user create', opts));

  user
    .command('update <user_id>')
    .description('Update a user account')
    .option('--email <email>', 'new email address')
    .option('--name <name>', 'new display name')
    .option('--role <role>', 'new account role: user or admin')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('user update', opts));
}
