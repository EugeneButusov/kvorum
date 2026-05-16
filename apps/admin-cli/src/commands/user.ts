import { Command } from 'commander';
import type { UserRole } from '@libs/db';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import {
  emit,
  emitNotImplemented,
  ExitCode,
  fail,
  type OutputFormat,
  resolveFormat,
} from '../output.js';

type UserCreateOptions = { email: string; name: string; role: string; format?: string };

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
    .action(async function action(opts: UserCreateOptions) {
      let format: OutputFormat = 'human';
      try {
        const globalFormat = this.optsWithGlobals()['format'];
        format = resolveFormat(
          opts.format,
          typeof globalFormat === 'string' ? globalFormat : undefined,
        );
        if (opts.role !== 'user' && opts.role !== 'admin') {
          fail(format, ExitCode.ValidationFailure, `--role must be 'user' or 'admin'`);
        }
        const { userRepository } = buildContainer();
        await withAudit('user create', { email: opts.email, role: opts.role }, async () => {
          const created = await userRepository.create({
            email: opts.email,
            displayName: opts.name,
            role: opts.role as UserRole,
          });
          emit(format, () => `User created: ${created.id} (${created.email})`, {
            id: created.id,
            email: created.email,
            display_name: created.display_name,
            role: created.role,
            created_at: created.created_at,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        if (message.startsWith('invalid --format value:')) {
          fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
        }
        fail(format, ExitCode.RuntimeFailure, 'user create failed', { message });
      }
    });

  user
    .command('update <user_id>')
    .description('Update a user account')
    .option('--email <email>', 'new email address')
    .option('--name <name>', 'new display name')
    .option('--role <role>', 'new account role: user or admin')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('user update', opts));
}
