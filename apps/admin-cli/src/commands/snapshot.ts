import { Command } from 'commander';
import { silentLogger } from '@libs/chain';
import {
  chDb,
  DlqRepository,
  pgDb,
  ProposalRepository,
  VotingPowerSnapshotRunRepository,
  VotingPowerSnapshotProjectionWriter,
} from '@libs/db';
import { SnapshotTickRunner, type SnapshotTickMetrics } from '@sources/core';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';
import { buildSnapshotStrategyMap } from '../plugins/backfill-source-plugins.js';

type SnapshotCommon = { format?: string };
const NOOP_METRICS: SnapshotTickMetrics = {
  populationSize: () => {},
  proposalsProcessed: () => {},
};

export function registerSnapshot(program: Command): void {
  const snapshot = program.command('snapshot').description('Voting power snapshot operations');

  snapshot
    .command('drain')
    .description('Run snapshot worker ticks until backlog is fully drained')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(opts: SnapshotCommon) {
      await withSnapshotFormat(this, opts, async (format) => {
        const strategies = buildSnapshotStrategyMap();
        const runner = new SnapshotTickRunner({
          proposalRepo: new ProposalRepository(pgDb),
          snapshotRepo: new VotingPowerSnapshotProjectionWriter(chDb),
          runRepo: new VotingPowerSnapshotRunRepository(pgDb),
          dlqRepo: new DlqRepository(pgDb),
          strategies,
          logger: silentLogger,
          metrics: NOOP_METRICS,
        });

        let processed = 0;
        let sawDlq = false;

        while (true) {
          const tick = await runner.tickOnce();
          if (tick.outcome === 'idle') {
            emit(format, () => `snapshot drain completed; processed=${processed}, dlq=${sawDlq}`, {
              status: 'completed',
              processed,
              dlq: sawDlq,
            });
            break;
          }

          if (tick.outcome === 'dlq') sawDlq = true;

          if (tick.outcome !== 'retry' && tick.outcome !== 'no_strategy') {
            processed += 1;
          }

          emit(
            format,
            () =>
              `processed ${processed} proposals so far, current=${tick.proposalId ?? 'n/a'}, outcome=${tick.outcome}`,
            {
              processed,
              proposal_id: tick.proposalId ?? null,
              outcome: tick.outcome,
            },
          );
        }

        if (sawDlq) {
          process.exit(ExitCode.RuntimeFailure);
        }
      });
    });
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
