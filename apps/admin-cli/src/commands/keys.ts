import { generateApiKey, hashApiKey, parsePepperSetFromEnv } from '@libs/auth';
import { Command } from 'commander';
import { buildContainer } from '../bootstrap.js';
import { withAudit } from '../audit.js';
import {
  emit,
  emitNotImplemented,
  ExitCode,
  fail,
  type OutputFormat,
  resolveFormat,
} from '../output.js';

type KeysCommon = { format?: string };
type KeysListOptions = KeysCommon & { user?: string };
type KeysRevokeOptions = KeysCommon & { dryRun?: boolean };
type KeysCreateOptions = KeysCommon & { label?: string; dryRun?: boolean };

export function registerKeys(program: Command): void {
  const keys = program.command('keys').description('API key management');

  keys
    .command('create <user_id>')
    .description('Create API key for user')
    .option('--label <label>', 'optional label')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(userId: string, opts: KeysCreateOptions) {
      await withKeysFormat(this, opts, async (format) => {
        const { apiKeyRepository, userRepository } = buildContainer();
        const user = await userRepository.findById(userId);
        if (user == null) {
          fail(format, ExitCode.NotFound, `user not found: ${userId}`);
        }
        if (opts.dryRun === true) {
          emit(format, () => `Would create API key for user ${userId}`, {
            user_id: userId,
            dry_run: true,
          });
          return;
        }
        const peppers = parsePepperSetFromEnv(process.env);
        const generated = generateApiKey();
        await withAudit('keys create', { userId, label: opts.label }, async () => {
          const created = await apiKeyRepository.create({
            userId,
            keyHash: hashApiKey(peppers.current, generated.key),
            prefix: generated.prefix,
            lastFour: generated.lastFour,
            label: opts.label,
            tier: 'authenticated_free',
          });
          emit(format, () => `API key created for ${userId}. Shown once: ${generated.key}`, {
            key_id: created.id,
            user_id: userId,
            api_key: generated.key,
          });
        });
      });
    });

  keys
    .command('list')
    .description('List API keys')
    .option('--user <id>', 'filter by user ID')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: KeysListOptions) {
      await withKeysFormat(this, opts, async (format) => {
        const { apiKeyRepository } = buildContainer();
        const rows = await apiKeyRepository.listByUser(opts.user);
        emit(
          format,
          () =>
            rows.length === 0
              ? 'No API keys found'
              : rows
                  .map((r) => `${r.id} user=${r.user_id} revoked=${r.revoked_at != null}`)
                  .join('\n'),
          { count: rows.length, items: rows },
        );
      });
    });

  keys
    .command('revoke <key_id>')
    .description('Revoke an API key')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(keyId: string, opts: KeysRevokeOptions) {
      await withKeysFormat(this, opts, async (format) => {
        if (opts.dryRun === true) {
          emit(format, () => `Would revoke key ${keyId}`, { key_id: keyId, dry_run: true });
          return;
        }
        const { apiKeyRepository } = buildContainer();
        await withAudit('keys revoke', { keyId }, async () => {
          const result = await apiKeyRepository.revoke(keyId);
          if (result === 'not_found') {
            fail(format, ExitCode.NotFound, `key not found: ${keyId}`);
          }
          emit(
            format,
            () =>
              result === 'already_revoked'
                ? `Key already revoked: ${keyId}`
                : `Key revoked: ${keyId}`,
            { key_id: keyId, status: result },
          );
        });
      });
    });

  keys
    .command('ban-ip <ip>')
    .description('Ban an IP address (destructive)')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_ip, opts) => emitNotImplemented('keys ban-ip', opts));
}

async function withKeysFormat(
  command: Command,
  opts: KeysCommon,
  run: (format: OutputFormat) => Promise<void>,
): Promise<void> {
  let format: OutputFormat = 'human';
  try {
    const globalFormat = command.optsWithGlobals()['format'];
    format = resolveFormat(
      opts.format,
      typeof globalFormat === 'string' ? globalFormat : undefined,
    );
    await run(format);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (message.startsWith('invalid --format value:')) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(format, ExitCode.RuntimeFailure, 'keys command failed', { message });
  }
}
