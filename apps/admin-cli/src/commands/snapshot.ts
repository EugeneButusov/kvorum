import { Command } from 'commander';
import { ChainContextRegistry, parseChainConfigFromEnv } from '@libs/chain';
import {
  chDb,
  DlqRepository,
  pgDb,
  ProposalRepository,
  type ProposalState,
  type SnapshotCandidate,
  VotingPowerSnapshotProjectionReadRepository,
  VotingPowerSnapshotRunRepository,
  VotingPowerSnapshotProjectionWriter,
} from '@libs/db';
import type { VotingPowerStrategy } from '@libs/domain';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';
import { buildSnapshotStrategyMap } from '../plugins/backfill-source-plugins.js';

type SnapshotCommon = { format?: string };

const SNAPSHOT_SAMPLE_SIZE = Number(process.env['SNAPSHOT_SAMPLE_SIZE'] ?? '20');
const SNAPSHOT_DLQ_THRESHOLD = 5;
const SNAPSHOT_DLQ_STAGE = 'snapshot_compute_stage';

const ELIGIBLE_STATES: ProposalState[] = [
  'active',
  'succeeded',
  'defeated',
  'queued',
  'executed',
  'expired',
  'vetoed',
];

type TickOutcomeType =
  | 'idle'
  | 'verified'
  | 'fallback_engaged'
  | 'empty_population'
  | 'no_strategy'
  | 'dlq'
  | 'retry';

interface TickOutcome {
  outcome: TickOutcomeType;
  proposalId?: string;
}

class SnapshotDrainRunner {
  constructor(
    private readonly proposals: ProposalRepository,
    private readonly snapshotProjectionWriter: VotingPowerSnapshotProjectionWriter,
    private readonly snapshotProjectionRead: VotingPowerSnapshotProjectionReadRepository,
    private readonly runs: VotingPowerSnapshotRunRepository,
    private readonly dlq: DlqRepository,
    private readonly strategies: Map<string, VotingPowerStrategy>,
  ) {}

  async tickOnce(): Promise<TickOutcome> {
    const candidate = await this.findNextProposalToSnapshot();
    if (candidate === undefined) return { outcome: 'idle' };

    const strategy = this.strategies.get(candidate.source_type);
    if (strategy === undefined) {
      await this.ensureNoStrategyFailure(candidate.id, candidate.voting_power_block);
      return { outcome: 'no_strategy', proposalId: candidate.id };
    }

    try {
      const existing = await this.runs.findByProposalId(candidate.id);
      if (existing?.status === 'in_progress') {
        await this.snapshotProjectionRead.deleteForProposal(candidate.id);
        await this.runs.touchAttempt(candidate.id, new Date());
      } else if (existing === undefined) {
        await this.runs.insertInProgress({
          proposal_id: candidate.id,
          voting_power_block: candidate.voting_power_block,
          started_at: new Date(),
        });
      }

      const block = BigInt(candidate.voting_power_block);
      const computed = await strategy.computeSnapshot(block, { daoId: candidate.dao_id });
      if (computed.length === 0) {
        await this.runs.markCompleted(candidate.id, {
          rows_inserted: 0,
          population_size: 0,
          sample_size: 0,
          fallback_engaged: false,
          completed_at: new Date(),
        });
        return { outcome: 'empty_population', proposalId: candidate.id };
      }

      await this.snapshotProjectionWriter.bulkInsert(
        computed.map((row) => ({
          dao_id: candidate.dao_id,
          proposal_id: candidate.id,
          actor_address: row.address,
          voting_power: row.power.toString(),
          actor_id_hint: row.actorId,
          computed_at: new Date(),
        })),
      );

      const sampleSize = Math.min(SNAPSHOT_SAMPLE_SIZE, computed.length);
      const sample = await this.snapshotProjectionRead.sampleForProposal(candidate.id, sampleSize);
      let mismatch = false;

      await Promise.all(
        sample.map(async (row) => {
          const onChain = await strategy.verifyOnChain(row.address, block, {
            daoId: candidate.dao_id,
          });
          if (onChain.toString() !== row.power) mismatch = true;
        }),
      );

      if (mismatch) {
        await this.applyFallback(candidate.id, candidate.dao_id, block, strategy);
      }

      await this.runs.markCompleted(candidate.id, {
        rows_inserted: computed.length,
        population_size: computed.length,
        sample_size: sampleSize,
        fallback_engaged: mismatch,
        completed_at: new Date(),
      });

      return {
        outcome: mismatch ? 'fallback_engaged' : 'verified',
        proposalId: candidate.id,
      };
    } catch (error) {
      const attempts = await this.runs.incrementAttempt(candidate.id, String(error), new Date());
      if (attempts.attempts >= SNAPSHOT_DLQ_THRESHOLD) {
        await this.runs.markFailed(candidate.id, {
          last_error: String(error),
          last_attempt_at: new Date(),
        });
        await this.dlq.insert({
          stage: SNAPSHOT_DLQ_STAGE,
          source: 'indexer.snapshot',
          payload: { proposal_id: candidate.id },
          error: { message: String(error) },
          retries: attempts.attempts,
          first_seen_at: new Date(),
          last_attempt_at: new Date(),
          archive_source_type: candidate.source_type,
          archive_chain_id: '0x1',
          archive_tx_hash: null,
          archive_log_index: null,
          archive_block_hash: null,
        });
        return { outcome: 'dlq', proposalId: candidate.id };
      }
      return { outcome: 'retry', proposalId: candidate.id };
    }
  }

  private async applyFallback(
    proposalId: string,
    daoId: string,
    block: bigint,
    strategy: VotingPowerStrategy,
  ): Promise<void> {
    const rows = await this.snapshotProjectionRead.listPrimaryAddressesForProposal(proposalId);

    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      await Promise.all(
        chunk.map(async (row) => {
          const power = await strategy.verifyOnChain(row.address, block, { daoId });
          await this.snapshotProjectionRead.updatePower(proposalId, row.address, power.toString());
        }),
      );
    }
  }

  private async findNextProposalToSnapshot(): Promise<SnapshotCandidate | undefined> {
    const supportedSourceTypes = [...this.strategies.keys()];
    return this.proposals.findNextSnapshotCandidate(
      supportedSourceTypes,
      ELIGIBLE_STATES,
      SNAPSHOT_DLQ_THRESHOLD,
    );
  }

  private async ensureNoStrategyFailure(
    proposalId: string,
    votingPowerBlock: string,
  ): Promise<void> {
    const existing = await this.runs.findByProposalId(proposalId);
    if (existing !== undefined) return;

    await this.runs.insertInProgress({
      proposal_id: proposalId,
      voting_power_block: votingPowerBlock,
      started_at: new Date(),
    });
    await this.runs.markFailed(proposalId, {
      last_error: 'no_strategy_registered',
      last_attempt_at: new Date(),
    });
  }
}

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

        const strategies = buildSnapshotStrategyMap({
          registry,
          chainId: chainCtx.chainCfg.chainId,
        });
        const runner = new SnapshotDrainRunner(
          new ProposalRepository(pgDb),
          new VotingPowerSnapshotProjectionWriter(chDb),
          new VotingPowerSnapshotProjectionReadRepository(chDb),
          new VotingPowerSnapshotRunRepository(pgDb),
          new DlqRepository(pgDb),
          strategies,
        );

        let processed = 0;
        let sawDlq = false;

        try {
          while (true) {
            const tick = await runner.tickOnce();
            if (tick.outcome === 'idle') {
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
