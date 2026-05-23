import { Command } from 'commander';
import { ChainContextRegistry, parseChainConfigFromEnv } from '@libs/chain';
import {
  DlqRepository,
  pgDb,
  VotingPowerSnapshotRepository,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import { SnapshotWorkerService } from '../../../indexer/src/snapshot/snapshot-worker.service.js';
import { CompoundCompTokenVotingPowerStrategy } from '@sources/compound';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';

type SnapshotCommon = { format?: string };

const SNAPSHOT_DRAIN_LOCK_KEY = 'snapshot_drain';

export function registerSnapshot(program: Command): void {
  const snapshot = program.command('snapshot').description('Voting power snapshot operations');

  snapshot
    .command('drain')
    .description('Run snapshot worker ticks until backlog is fully drained')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: SnapshotCommon) {
      await withSnapshotFormat(this, opts, async (format) => {
        const chainConfig = resolveMainnetChainConfig(format);
        const registry = new ChainContextRegistry();
        const chainCtx = await registry.getOrCreate(chainConfig);

        const strategy = new CompoundCompTokenVotingPowerStrategy(
          pgDb,
          registry,
          chainCtx.chainCfg.chainId,
        );
        const worker = new SnapshotWorkerService(
          pgDb,
          new VotingPowerSnapshotRepository(pgDb),
          new VotingPowerSnapshotRunRepository(pgDb),
          new DlqRepository(pgDb),
          new Map([
            ['compound_governor_alpha', strategy],
            ['compound_governor_bravo', strategy],
            ['compound_governor_oz', strategy],
          ]),
        );

        let processed = 0;
        let sawDlq = false;

        try {
          await pgDb.connection().execute(async (conn) => {
            const lock = await conn
              .selectNoFrom((eb) =>
                eb
                  .fn<boolean>('pg_try_advisory_lock', [
                    eb.fn('hashtext', [eb.val(SNAPSHOT_DRAIN_LOCK_KEY)]),
                  ])
                  .as('acquired'),
              )
              .executeTakeFirstOrThrow();

            if (!lock.acquired) {
              fail(
                format,
                ExitCode.ValidationFailure,
                'another snapshot drain or indexer tick holds the lock',
              );
            }

            try {
              while (true) {
                const result = await worker.tickOnce();
                if (result.outcome === 'idle') {
                  emit(
                    format,
                    () => `snapshot drain completed; processed=${processed}, dlq=${sawDlq}`,
                    {
                      status: 'completed',
                      processed,
                      dlq: sawDlq,
                    },
                  );
                  break;
                }

                if (result.outcome === 'dlq') sawDlq = true;

                if (result.outcome !== 'retry' && result.outcome !== 'no_strategy') {
                  processed += 1;
                }

                emit(
                  format,
                  () =>
                    `processed ${processed} proposals so far, current=${result.proposalId ?? 'n/a'}, outcome=${result.outcome}`,
                  {
                    processed,
                    proposal_id: result.proposalId ?? null,
                    outcome: result.outcome,
                  },
                );
              }
            } finally {
              await conn
                .selectNoFrom((eb) =>
                  eb
                    .fn('pg_advisory_unlock', [
                      eb.fn('hashtext', [eb.val(SNAPSHOT_DRAIN_LOCK_KEY)]),
                    ])
                    .as('released'),
                )
                .executeTakeFirst();
            }
          });
        } finally {
          await registry.drainAll();
        }

        if (sawDlq) {
          process.exit(ExitCode.RuntimeFailure);
        }
      });
    });
}

function resolveMainnetChainConfig(format: OutputFormat) {
  const chains = parseChainConfigFromEnv(process.env);
  const mainnet = chains.find((chain) => chain.chainId === '0x1');
  if (mainnet == null) {
    fail(
      format,
      ExitCode.RuntimeFailure,
      'CHAIN_CONFIG does not contain chain 0x1 required for snapshot drain',
    );
  }
  return mainnet;
}

async function withSnapshotFormat(
  command: Command,
  opts: SnapshotCommon,
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
    fail(format, ExitCode.RuntimeFailure, 'snapshot command failed', { message });
  }
}
