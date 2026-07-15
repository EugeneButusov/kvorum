import { Command } from 'commander';
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
import { validateSourceConfig } from '../plugins/source-config-validation.js';

type DaoCommon = { format?: string };
type DaoAddOpts = DaoCommon & { name: string; token: string; chain: string };
type DaoSourceAddOpts = DaoCommon & { type: string; chain: string; config: string };
type DaoSourceUpdateOpts = DaoCommon & { config: string };

export function registerDao(program: Command): void {
  const dao = program.command('daos').description('DAO management');

  dao
    .command('add <slug>')
    .description('Register a new DAO')
    .requiredOption('--name <name>', 'display name')
    .requiredOption('--token <address>', 'governance token address')
    .requiredOption('--chain <id>', 'chain ID')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(slug: string, opts: DaoAddOpts) {
      await withDaoFormat(this, opts, async (format) => {
        const { daoAdminRepository } = buildContainer();
        await withAudit('daos add', { slug, ...opts }, async () => {
          const { normalizeChainId } = await import('@libs/chain');
          const row = await daoAdminRepository.createDao({
            slug,
            name: opts.name,
            primaryTokenAddress: opts.token.toLowerCase(),
            primaryChainId: normalizeChainId(opts.chain),
          });
          emit(format, () => `DAO created: ${row.slug} (${row.id})`, {
            id: row.id,
            slug: row.slug,
            primary_chain_id: row.primary_chain_id,
          });
        });
      });
    });

  const source = dao.command('source').description('DAO source management');

  source
    .command('add <dao_slug>')
    .description('Add a data source to a DAO')
    .requiredOption('--type <type>', 'source type')
    .requiredOption('--chain <id>', 'chain ID')
    .requiredOption('--config <json>', 'source configuration JSON')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSlug: string, opts: DaoSourceAddOpts) {
      await withDaoFormat(this, opts, async (format) => {
        const { daoAdminRepository } = buildContainer();
        await withAudit('daos source add', { daoSlug, ...opts }, async () => {
          const dao = await daoAdminRepository.findDaoBySlug(daoSlug);
          if (dao == null) {
            fail(format, ExitCode.NotFound, `dao not found: ${daoSlug}`);
          }

          const config = parseJson(opts.config, '--config');
          validateSourceConfigOrFail(format, opts.type, config);
          const { normalizeChainId } = await import('@libs/chain');
          const row = await daoAdminRepository.addSource({
            daoId: dao.id,
            sourceType: opts.type,
            chainId: normalizeChainId(opts.chain),
            sourceConfig: config,
          });
          emit(format, () => `DAO source created: ${row.id}`, {
            id: row.id,
            dao_id: row.dao_id,
            source_type: row.source_type,
            chain_id: row.chain_id,
          });
        });
      });
    });

  source
    .command('update <dao_source_id>')
    .description('Update a DAO source configuration')
    .requiredOption('--config <json>', 'updated configuration JSON')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: DaoSourceUpdateOpts) {
      await withDaoFormat(this, opts, async (format) => {
        const { daoAdminRepository } = buildContainer();
        await withAudit('daos source update', { daoSourceId, ...opts }, async () => {
          const existing = await daoAdminRepository.findSourceById(daoSourceId);
          if (existing == null) {
            fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
          }
          const config = parseJson(opts.config, '--config');
          validateSourceConfigOrFail(format, existing.source_type, config);
          const updated = await daoAdminRepository.updateSourceConfig(daoSourceId, config);
          emit(format, () => `DAO source updated: ${daoSourceId}`, {
            id: daoSourceId,
            updated_rows: updated,
          });
        });
      });
    });

  source
    .command('pause <dao_source_id>')
    .description(
      'Turn OFF live polling for a source (cursor held; use before its backfill). Applies on next indexer restart.',
    )
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: DaoCommon) {
      await withDaoFormat(this, opts, async (format) => {
        const { daoAdminRepository } = buildContainer();
        await withAudit('daos source pause', { daoSourceId }, async () => {
          const existing = await daoAdminRepository.findSourceById(daoSourceId);
          if (existing == null) {
            fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
          }
          const updated = await daoAdminRepository.setSourceLivePolling(daoSourceId, false);
          emit(
            format,
            () => `Live polling PAUSED for ${daoSourceId} — restart the indexer to apply`,
            { id: daoSourceId, updated_rows: updated, live_polling_enabled: false },
          );
        });
      });
    });

  source
    .command('resume <dao_source_id>')
    .description('Turn live polling back ON for a source. Applies on next indexer restart.')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: DaoCommon) {
      await withDaoFormat(this, opts, async (format) => {
        const { daoAdminRepository } = buildContainer();
        await withAudit('daos source resume', { daoSourceId }, async () => {
          const existing = await daoAdminRepository.findSourceById(daoSourceId);
          if (existing == null) {
            fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
          }
          const updated = await daoAdminRepository.setSourceLivePolling(daoSourceId, true);
          emit(
            format,
            () => `Live polling RESUMED for ${daoSourceId} — restart the indexer to apply`,
            { id: daoSourceId, updated_rows: updated, live_polling_enabled: true },
          );
        });
      });
    });

  source
    .command('delete <dao_source_id>')
    .description('Delete a DAO source (destructive)')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_id, opts) => emitNotImplemented('daos source delete', opts));
}

function parseJson(raw: string, optionName: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${optionName} must be valid JSON`);
  }
}

/**
 * Validates the source_config for `sourceType` (dispatching to that source's parseConfig across all
 * ingesters, EVM + off-chain) and exits with a ValidationFailure on a bad config or an unrecognized
 * source_type. Replaces the earlier Compound-only check that silently accepted every other type.
 */
function validateSourceConfigOrFail(
  format: OutputFormat,
  sourceType: string,
  config: unknown,
): void {
  try {
    validateSourceConfig(sourceType, config);
  } catch (error) {
    fail(
      format,
      ExitCode.ValidationFailure,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function withDaoFormat(
  command: Command,
  opts: DaoCommon,
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
    if (message.startsWith('invalid --format value:') || message.includes('must be valid JSON')) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(format, ExitCode.RuntimeFailure, 'daos command failed', { message });
  }
}
