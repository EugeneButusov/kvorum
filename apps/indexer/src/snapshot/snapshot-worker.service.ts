import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  DlqRepository,
  ProposalRepository,
  type ProposalState,
  type SnapshotCandidate,
  VotingPowerSnapshotRepository,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import type { VotingPowerStrategy } from '@libs/domain';
import type { SourcePlugin } from '@sources/core';
import { snapshotMetrics } from './snapshot-metrics';

const SNAPSHOT_INTERVAL_MS = readIntervalMs('SNAPSHOT_INTERVAL_MS', 30_000);
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

export interface TickOutcome {
  outcome: TickOutcomeType;
  proposalId?: string;
}

type SnapshotStrategies = Map<string, VotingPowerStrategy>;

@Injectable()
export class SnapshotWorkerService {
  private readonly logger = new Logger('SnapshotWorker');
  private inFlight = false;

  constructor(
    private readonly proposalRepo: ProposalRepository,
    private readonly snapshotRepo: VotingPowerSnapshotRepository,
    private readonly runRepo: VotingPowerSnapshotRunRepository,
    private readonly dlqRepo: DlqRepository,
    private readonly strategies: SnapshotStrategies,
  ) {}

  static buildStrategies(plugins: readonly SourcePlugin[]): SnapshotStrategies {
    const strategies = new Map<string, VotingPowerStrategy>();
    for (const plugin of plugins) {
      for (const entry of plugin.snapshotStrategies) {
        for (const sourceType of entry.sourceTypes) {
          strategies.set(sourceType, entry.strategy);
        }
      }
    }
    return strategies;
  }

  @Interval(SNAPSHOT_INTERVAL_MS)
  async tick(): Promise<void> {
    await this.tickOnce();
  }

  async tickOnce(): Promise<TickOutcome> {
    if (this.inFlight) return { outcome: 'retry' };
    this.inFlight = true;
    const startedAt = Date.now();

    let activeCandidate: SnapshotCandidate | undefined;

    try {
      const candidate = await this.findNextProposalToSnapshot();
      activeCandidate = candidate;
      if (candidate === undefined) return { outcome: 'idle' };

      const strategy = this.strategies.get(candidate.source_type);
      if (strategy === undefined) {
        await this.ensureNoStrategyFailure(candidate.id, candidate.voting_power_block);
        return { outcome: 'no_strategy', proposalId: candidate.id };
      }

      const existing = await this.runRepo.findByProposalId(candidate.id);
      if (existing?.status === 'in_progress') {
        await this.snapshotRepo.deleteForProposal(candidate.id);
        await this.runRepo.touchAttempt(candidate.id, new Date());
      } else if (existing === undefined) {
        await this.runRepo.insertInProgress({
          proposal_id: candidate.id,
          voting_power_block: candidate.voting_power_block,
          started_at: new Date(),
        });
      }

      const block = BigInt(candidate.voting_power_block);
      const computed = await strategy.computeSnapshot(block, { daoId: candidate.dao_id });
      snapshotMetrics.populationSize.record(computed.length);

      if (computed.length === 0) {
        await this.runRepo.markCompleted(candidate.id, {
          rows_inserted: 0,
          population_size: 0,
          sample_size: 0,
          fallback_engaged: false,
          completed_at: new Date(),
        });
        snapshotMetrics.proposalsProcessed.add(1, { outcome: 'empty_population' });
        return { outcome: 'empty_population', proposalId: candidate.id };
      }

      await this.snapshotRepo.bulkInsert(
        computed.map((row) => ({
          actor_id: row.actorId,
          dao_id: candidate.dao_id,
          proposal_id: candidate.id,
          block_number: candidate.voting_power_block,
          power: row.power.toString(),
        })),
      );

      const sampleSize = Math.min(SNAPSHOT_SAMPLE_SIZE, computed.length);
      const sample = await this.snapshotRepo.sampleForProposal(candidate.id, sampleSize);
      let mismatch = false;

      await Promise.all(
        sample.map(async (row) => {
          snapshotMetrics.rpcCalls.add(1, { kind: 'sample' });
          const onChain = await strategy.verifyOnChain(row.address, block, {
            daoId: candidate.dao_id,
          });
          if (onChain.toString() !== row.power) {
            mismatch = true;
            snapshotMetrics.sampleMismatch.add(1, { source_type: candidate.source_type });
          }
        }),
      );

      if (mismatch) {
        await this.applyFallback(candidate.id, candidate.dao_id, block, strategy);
      }

      await this.runRepo.markCompleted(candidate.id, {
        rows_inserted: computed.length,
        population_size: computed.length,
        sample_size: sampleSize,
        fallback_engaged: mismatch,
        completed_at: new Date(),
      });

      snapshotMetrics.proposalsProcessed.add(1, {
        outcome: mismatch ? 'fallback_engaged' : 'verified',
      });

      return {
        outcome: mismatch ? 'fallback_engaged' : 'verified',
        proposalId: candidate.id,
      };
    } catch (error) {
      this.logger.error('snapshot_tick_failed', { error: String(error) });
      const proposal = activeCandidate;
      if (proposal !== undefined) {
        const attempts = await this.runRepo.incrementAttempt(
          proposal.id,
          String(error),
          new Date(),
        );
        if (attempts.attempts >= SNAPSHOT_DLQ_THRESHOLD) {
          await this.runRepo.markFailed(proposal.id, {
            last_error: String(error),
            last_attempt_at: new Date(),
          });
          await this.dlqRepo.insert({
            stage: SNAPSHOT_DLQ_STAGE,
            source: 'indexer.snapshot',
            payload: { proposal_id: proposal.id },
            error: { message: String(error) },
            retries: attempts.attempts,
            first_seen_at: new Date(),
            last_attempt_at: new Date(),
            archive_source_type: proposal.source_type,
            archive_chain_id: '0x1',
            archive_tx_hash: null,
            archive_log_index: null,
            archive_block_hash: null,
          });
          return { outcome: 'dlq', proposalId: proposal.id };
        }
        return { outcome: 'retry', proposalId: proposal.id };
      }
      return { outcome: 'retry' };
    } finally {
      snapshotMetrics.durationSeconds.record((Date.now() - startedAt) / 1000);
      this.inFlight = false;
    }
  }

  private async applyFallback(
    proposalId: string,
    daoId: string,
    block: bigint,
    strategy: VotingPowerStrategy,
  ): Promise<void> {
    const rows = await this.snapshotRepo.listPrimaryAddressesForProposal(proposalId);

    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      await Promise.all(
        chunk.map(async (row) => {
          snapshotMetrics.rpcCalls.add(1, { kind: 'fallback' });
          const power = await strategy.verifyOnChain(row.address, block, { daoId });
          await this.snapshotRepo.updatePower(proposalId, row.actorId, power.toString());
        }),
      );
    }
  }

  private async findNextProposalToSnapshot(): Promise<SnapshotCandidate | undefined> {
    const supportedSourceTypes = [...this.strategies.keys()];
    return this.proposalRepo.findNextSnapshotCandidate(
      supportedSourceTypes,
      ELIGIBLE_STATES,
      SNAPSHOT_DLQ_THRESHOLD,
    );
  }

  private async ensureNoStrategyFailure(
    proposalId: string,
    votingPowerBlock: string,
  ): Promise<void> {
    const existing = await this.runRepo.findByProposalId(proposalId);
    if (existing !== undefined) return;

    await this.runRepo.insertInProgress({
      proposal_id: proposalId,
      voting_power_block: votingPowerBlock,
      started_at: new Date(),
    });
    await this.runRepo.markFailed(proposalId, {
      last_error: 'no_strategy_registered',
      last_attempt_at: new Date(),
    });
  }
}

function readIntervalMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
