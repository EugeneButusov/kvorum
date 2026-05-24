import { Command } from 'commander';
import {
  ChainContextRegistry,
  EnsClient,
  parseChainConfigFromEnv,
  tickEnsResolution,
} from '@libs/chain';
import { emit, ExitCode, fail, resolveFormat, type OutputFormat } from '../output.js';

const MAINNET_CHAIN_ID = '0x1';
const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/;
const DEFAULT_PAGE_LIMIT = 500;
const MAX_PAGE_LIMIT = 5000;

export function registerEns(program: Command): void {
  const ens = program.command('ens').description('ENS resolver operations');

  ens
    .command('refresh-all')
    .description('Refresh ENS display names for all actors')
    .option(
      '--limit-per-page <number>',
      `page size (${DEFAULT_PAGE_LIMIT} default, ${MAX_PAGE_LIMIT} max)`,
    )
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: { limitPerPage?: string; format?: string }) {
      await withEnsFormat(this, opts, async (format) => {
        const limitPerPage = parseLimitPerPage(opts.limitPerPage, format);
        const { buildContainer } = await import('../bootstrap.js');
        const actorRepo = buildContainer().actorRepository;

        const registry = new ChainContextRegistry();
        try {
          const ensClient = await createEnsClient(registry, format);

          let pages = 0;
          const totals = { resolved: 0, no_record: 0, mismatch: 0, error: 0 };

          for (;;) {
            const result = await tickEnsResolution({
              ensClient,
              actorRepo,
              opts: { limit: limitPerPage, ttlSeconds: 0 },
            });

            if (result.outcome === 'idle') break;

            pages += 1;
            totals.resolved += result.counts.resolved;
            totals.no_record += result.counts.no_record;
            totals.mismatch += result.counts.mismatch;
            totals.error += result.counts.error;

            if (format === 'human') {
              process.stdout.write(
                [
                  `page ${pages}: resolved=${result.counts.resolved}`,
                  `no_record=${result.counts.no_record}`,
                  `mismatch=${result.counts.mismatch}`,
                  `error=${result.counts.error}`,
                ].join(' ') + '\n',
              );
            }
          }

          emit(
            format,
            () =>
              [
                'ENS refresh-all completed',
                `pages: ${pages}`,
                `resolved: ${totals.resolved}`,
                `no_record: ${totals.no_record}`,
                `mismatch: ${totals.mismatch}`,
                `error: ${totals.error}`,
              ].join('\n'),
            { command: 'ens refresh-all', pages, ...totals },
          );
        } finally {
          await registry.drainAll();
        }
      });
    });

  ens
    .command('refresh <address>')
    .description('Refresh ENS display name for one actor primary address')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(address: string, opts: { format?: string }) {
      await withEnsFormat(this, opts, async (format) => {
        validateAddressShape(address, '<address>', format);
        const normalized = address.toLowerCase();
        const { buildContainer } = await import('../bootstrap.js');
        const actorRepo = buildContainer().actorRepository;

        const actor = await actorRepo.findByAddress(normalized);
        if (actor == null || actor.primary_address !== normalized) {
          fail(format, ExitCode.NotFound, `primary actor not found for address: ${normalized}`);
        }

        const registry = new ChainContextRegistry();
        try {
          const ensClient = await createEnsClient(registry, format);
          const outcomes = await ensClient.batchReverseResolve([normalized]);
          const outcome = outcomes.get(normalized) ?? { kind: 'error', reason: 'missing_outcome' };

          if (outcome.kind === 'resolved') {
            await actorRepo.updateDisplayName({ actorId: actor.id, displayName: outcome.name });
          } else if (outcome.kind === 'no_record') {
            await actorRepo.updateDisplayName({ actorId: actor.id, displayName: null });
          }

          emit(
            format,
            () =>
              [
                `ENS refresh completed for ${normalized}`,
                `result: ${outcome.kind}`,
                outcome.kind === 'resolved' ? `name: ${outcome.name}` : null,
                outcome.kind === 'mismatch' ? `reverse_name: ${outcome.reverseName}` : null,
                outcome.kind === 'error' ? `reason: ${outcome.reason}` : null,
              ]
                .filter((line): line is string => line !== null)
                .join('\n'),
            { command: 'ens refresh', address: normalized, result: outcome },
          );
        } finally {
          await registry.drainAll();
        }
      });
    });
}

async function createEnsClient(
  registry: ChainContextRegistry,
  format: OutputFormat,
): Promise<EnsClient> {
  const chains = parseChainConfigFromEnv(process.env);
  const mainnet = chains.find((entry) => entry.chainId.toLowerCase() === MAINNET_CHAIN_ID);
  if (mainnet == null) {
    fail(format, ExitCode.RuntimeFailure, 'CHAIN_CONFIG does not contain mainnet (0x1)');
  }

  const context = await registry.getOrCreate(mainnet);
  return new EnsClient(context.client);
}

function parseLimitPerPage(raw: string | undefined, format: OutputFormat): number {
  if (raw == null) return DEFAULT_PAGE_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    fail(
      format,
      ExitCode.ValidationFailure,
      `--limit-per-page must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
    );
  }
  return value;
}

function validateAddressShape(address: string, optionName: string, format: OutputFormat): void {
  if (!ADDRESS_PATTERN.test(address)) {
    fail(
      format,
      ExitCode.ValidationFailure,
      `${optionName} must be a lowercase 0x-prefixed 40-byte hex address`,
    );
  }
}

async function withEnsFormat(
  command: Command,
  opts: { format?: string },
  run: (format: OutputFormat) => Promise<void>,
): Promise<void> {
  try {
    const globalFormat = command.optsWithGlobals()['format'];
    const format = resolveFormat(
      opts.format,
      typeof globalFormat === 'string' ? globalFormat : undefined,
    );
    await run(format);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (message.startsWith('invalid --format value:')) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(opts.format === 'json' ? 'json' : 'human', ExitCode.RuntimeFailure, message);
  }
}
