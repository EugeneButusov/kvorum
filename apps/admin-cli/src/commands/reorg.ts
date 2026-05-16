import { Command } from 'commander';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';

type ReorgListOptions = {
  chain?: string;
  since?: string;
  format?: string;
};

export function registerReorg(program: Command): void {
  const reorg = program.command('reorg').description('Chain reorg management');

  reorg
    .command('list')
    .description('List detected chain reorgs')
    .option('--chain <id>', 'filter by chain ID')
    .option('--since <iso>', 'filter by ISO timestamp')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: ReorgListOptions) {
      await withReorgFormat(this, opts, async (format) => {
        const { reorgEventRepository } = buildContainer();
        const since = opts.since == null ? undefined : new Date(opts.since);
        if (since != null && Number.isNaN(since.getTime())) {
          fail(format, ExitCode.ValidationFailure, '--since must be an ISO timestamp');
        }

        const chainIds =
          opts.chain != null
            ? [opts.chain]
            : (await import('@libs/chain'))
                .parseChainConfigFromEnv(process.env)
                .map((c) => c.chainId);
        const events = (
          await Promise.all(
            chainIds.map((chainId) =>
              since == null
                ? reorgEventRepository.listRecent(chainId, 100)
                : reorgEventRepository.listRecentSince(chainId, since, 100),
            ),
          )
        )
          .flat()
          .sort((a, b) => b.detected_at.getTime() - a.detected_at.getTime());

        emit(
          format,
          () =>
            events.length === 0
              ? 'No reorg events found'
              : events
                  .map(
                    (e) =>
                      `${e.chain_id} ${e.detected_at.toISOString()} divergence=${e.divergence_block_number}`,
                  )
                  .join('\n'),
          {
            count: events.length,
            items: events.map((e) => ({
              id: e.id,
              chain_id: e.chain_id,
              detected_at: e.detected_at.toISOString(),
              divergence_block_number: e.divergence_block_number,
            })),
          },
        );
      });
    });
}

async function withReorgFormat(
  command: Command,
  opts: ReorgListOptions,
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
    fail(format, ExitCode.RuntimeFailure, 'reorg command failed', { message });
  }
}
