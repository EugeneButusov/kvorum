import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ActorRepository,
  DlqRepository,
  ProposalRepository,
  type ProposalState,
  type SnapshotCandidate,
  VotingPowerSnapshotProjectionWriter,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import type { SourcePlugin, SourceSnapshotStrategy } from '@sources/core';
import { snapshotMetrics } from './snapshot-metrics';
import { readIntervalMs } from '../app/env-helpers';

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

type SnapshotStrategies = Map<string, SourceSnapshotStrategy>;

@Injectable()
export class SnapshotWorkerService {
  private readonly logger = new Logger('SnapshotWorker');
  private inFlight = false;

  constructor(
    private readonly proposalRepo: ProposalRepository,
    private readonly snapshotRepo: VotingPowerSnapshotProjectionWriter,
    private readonly actorRepo: ActorRepository,
    private readonly runRepo: VotingPowerSnapshotRunRepository,
    private readonly dlqRepo: DlqRepository,
    private readonly strategies: SnapshotStrategies,
  ) {}

  static buildStrategies(plugins: readonly SourcePlugin[]): SnapshotStrategies {
    const strategies = new Map<string, SourceSnapshotStrategy>();
    for (const plugin of plugins) {
      for (const entry of plugin.snapshotStrategies) {
        for (const sourceType of entry.sourceTypes) {
          strategies.set(sourceType, entry);
        }
      }
    }
    return strategies;
  }

  @Interval(SNAPSHOT_INTERVAL_MS)
  /* v8 ignore next -- prod-only-DI: tick() is invoked by NestJS @Interval scheduler, not directly in unit tests */
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

      const strategyEntry = this.strategies.get(candidate.source_type);
      if (strategyEntry === undefined) {
        await this.ensureNoStrategyFailure(candidate.id, candidate.voting_power_block);
        return { outcome: 'no_strategy', proposalId: candidate.id };
      }

      const existing = await this.runRepo.findByProposalId(candidate.id);
      if (existing?.status === 'in_progress') {
        await this.runRepo.touchAttempt(candidate.id, new Date());
      } else if (existing === undefined) {
        await this.runRepo.insertInProgress({
          proposal_id: candidate.id,
          voting_power_block: candidate.voting_power_block,
          started_at: new Date(),
        });
      }

      const block = BigInt(candidate.voting_power_block);
      const computed = await strategyEntry.strategy.computeSnapshot(block, {
        daoId: candidate.dao_id,
        proposalId: candidate.id,
      });
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

      const actorIds = computed.map((row) => row.actorId);
      const addresses = await this.actorRepo.findPrimaryAddressesByActorIds(actorIds);
      const primaryByActorId = new Map(addresses.map((row) => [row.actor_id, row.address]));

      const snapshotRows = computed.flatMap((row) => {
        const primaryAddress = primaryByActorId.get(row.actorId);
        if (primaryAddress === undefined) return [];
        return [
          {
            dao_id: candidate.dao_id,
            proposal_id: candidate.id,
            actor_address: primaryAddress,
            voter_address: row.votingAddress ?? primaryAddress,
            voting_power: row.power.toString(),
            actor_id_hint: row.actorId,
            computed_at: new Date(),
          },
        ];
      });

      await this.snapshotRepo.bulkInsert(snapshotRows);

      const sampleSize = Math.min(SNAPSHOT_SAMPLE_SIZE, computed.length);

      await this.runRepo.markCompleted(candidate.id, {
        rows_inserted: computed.length,
        population_size: computed.length,
        sample_size: sampleSize,
        fallback_engaged: false,
        completed_at: new Date(),
      });

      snapshotMetrics.proposalsProcessed.add(1, {
        outcome: 'verified',
      });

      return {
        outcome: 'verified',
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

  private async findNextProposalToSnapshot(): Promise<SnapshotCandidate | undefined> {
    const supportedSourceTypes = [...this.strategies.keys()];
    const blockedIds = (
      await Promise.all(
        [...new Set(this.strategies.values())].map(
          (entry) => entry.getBlockedProposalIds?.() ?? Promise.resolve([]),
        ),
      )
    ).flat();
    return this.proposalRepo.findNextSnapshotCandidate(
      supportedSourceTypes,
      ELIGIBLE_STATES,
      SNAPSHOT_DLQ_THRESHOLD,
      blockedIds,
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
