import { Command } from 'commander';
import { emitNotImplemented } from '../output.js';

export function registerKeys(program: Command): void {
  const keys = program.command('keys').description('API key management');

  keys
    .command('list')
    .description('List API keys')
    .option('--user <id>', 'filter by user ID')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => emitNotImplemented('keys list', opts));

  keys
    .command('revoke <key_id>')
    .description('Revoke an API key')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('keys revoke', opts));

  keys
    .command('ban-ip <ip>')
    .description('Ban an IP address (destructive)')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_ip, opts) => emitNotImplemented('keys ban-ip', opts));
}
