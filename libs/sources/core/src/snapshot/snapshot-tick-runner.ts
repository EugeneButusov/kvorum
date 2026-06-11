import { silentLogger, type Logger } from '@libs/chain';
import type {
  DlqRepository,
  ProposalRepository,
  ProposalState,
  SnapshotCandidate,
  VotingPowerSnapshotProjectionWriter,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';
import type { SourcePlugin, SourceSnapshotStrategy } from '../index';

export const SNAPSHOT_DLQ_THRESHOLD = 5;
export const SNAPSHOT_DLQ_STAGE = 'snapshot_compute_stage';
export const SNAPSHOT_ELIGIBLE_STATES: readonly ProposalState[] = [
  'active',
  'succeeded',
  'defeated',
  'queued',
  'executed',
  'expired',
  'vetoed',
];

export type SnapshotTickOutcomeType =
  | 'idle'
  | 'verified'
  | 'empty_population'
  | 'no_strategy'
  | 'dlq'
  | 'retry';

export interface SnapshotTickOutcome {
  outcome: SnapshotTickOutcomeType;
  proposalId?: string;
}

export interface SnapshotTickMetrics {
  populationSize(size: number): void;
  proposalsProcessed(
    outcome: Extract<SnapshotTickOutcomeType, 'verified' | 'empty_population'>,
  ): void;
}

export interface SnapshotTickRunnerDeps {
  proposalRepo: ProposalRepository;
  snapshotRepo: VotingPowerSnapshotProjectionWriter;
  runRepo: VotingPowerSnapshotRunRepository;
  dlqRepo: DlqRepository;
  strategies: Map<string, SourceSnapshotStrategy>;
  logger?: Logger;
  metrics?: SnapshotTickMetrics;
  eligibleStates?: readonly ProposalState[];
  dlqThreshold?: number;
  dlqStage?: string;
  dlqSource?: string;
}

const NOOP_METRICS: SnapshotTickMetrics = {
  populationSize: () => {},
  proposalsProcessed: () => {},
};

export function buildSnapshotStrategies(
  plugins: readonly SourcePlugin[],
): Map<string, SourceSnapshotStrategy> {
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

export class SnapshotTickRunner {
  private readonly logger: Logger;
  private readonly metrics: SnapshotTickMetrics;
  private readonly eligibleStates: readonly ProposalState[];
  private readonly dlqThreshold: number;
  private readonly dlqStage: string;
  private readonly dlqSource: string;

  constructor(private readonly deps: SnapshotTickRunnerDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.metrics = deps.metrics ?? NOOP_METRICS;
    this.eligibleStates = deps.eligibleStates ?? SNAPSHOT_ELIGIBLE_STATES;
    this.dlqThreshold = deps.dlqThreshold ?? SNAPSHOT_DLQ_THRESHOLD;
    this.dlqStage = deps.dlqStage ?? SNAPSHOT_DLQ_STAGE;
    this.dlqSource = deps.dlqSource ?? 'indexer.snapshot';
  }

  async tickOnce(): Promise<SnapshotTickOutcome> {
    let activeCandidate: SnapshotCandidate | undefined;

    try {
      const candidate = await this.findNextProposalToSnapshot();
      activeCandidate = candidate;
      if (candidate === undefined) return { outcome: 'idle' };

      const strategyEntry = this.deps.strategies.get(candidate.source_type);
      if (strategyEntry === undefined) {
        await this.ensureNoStrategyFailure(candidate.id, candidate.voting_power_block);
        return { outcome: 'no_strategy', proposalId: candidate.id };
      }

      const existing = await this.deps.runRepo.findByProposalId(candidate.id);
      if (existing?.status === 'in_progress') {
        await this.deps.runRepo.touchAttempt(candidate.id, new Date());
      } else if (existing === undefined) {
        await this.deps.runRepo.insertInProgress({
          proposal_id: candidate.id,
          voting_power_block: candidate.voting_power_block,
          started_at: new Date(),
        });
      }

      const computed = await strategyEntry.strategy.computeSnapshot(
        BigInt(candidate.voting_power_block),
        {
          daoId: candidate.dao_id,
          proposalId: candidate.id,
        },
      );
      this.metrics.populationSize(computed.length);

      if (computed.length === 0) {
        await this.deps.runRepo.markCompleted(candidate.id, {
          rows_inserted: 0,
          population_size: 0,
          sample_size: 0,
          fallback_engaged: false,
          completed_at: new Date(),
        });
        this.metrics.proposalsProcessed('empty_population');
        return { outcome: 'empty_population', proposalId: candidate.id };
      }

      await this.deps.snapshotRepo.bulkInsert(
        computed.map((row) => ({
          dao_id: candidate.dao_id,
          proposal_id: candidate.id,
          actor_address: row.address,
          voter_address: row.votingAddress ?? row.address,
          voting_power: row.power.toString(),
          actor_id_hint: row.actorId,
          computed_at: new Date(),
        })),
      );

      await this.deps.runRepo.markCompleted(candidate.id, {
        rows_inserted: computed.length,
        population_size: computed.length,
        sample_size: 0,
        fallback_engaged: false,
        completed_at: new Date(),
      });
      this.metrics.proposalsProcessed('verified');
      return { outcome: 'verified', proposalId: candidate.id };
    } catch (error) {
      this.logger.error('snapshot_tick_failed', { error: String(error) });
      const proposal = activeCandidate;
      if (proposal === undefined) {
        return { outcome: 'retry' };
      }

      const attempts = await this.deps.runRepo.incrementAttempt(
        proposal.id,
        String(error),
        new Date(),
      );
      if (attempts.attempts >= this.dlqThreshold) {
        await this.deps.runRepo.markFailed(proposal.id, {
          last_error: String(error),
          last_attempt_at: new Date(),
        });
        await this.deps.dlqRepo.insert({
          stage: this.dlqStage,
          source: this.dlqSource,
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
  }

  private async findNextProposalToSnapshot(): Promise<SnapshotCandidate | undefined> {
    const supportedSourceTypes = [...this.deps.strategies.keys()];
    const blockedIds = (
      await Promise.all(
        [...new Set(this.deps.strategies.values())].map(
          (entry) => entry.getBlockedProposalIds?.() ?? Promise.resolve([]),
        ),
      )
    ).flat();

    return this.deps.proposalRepo.findNextSnapshotCandidate(
      supportedSourceTypes,
      this.eligibleStates,
      this.dlqThreshold,
      blockedIds,
    );
  }

  private async ensureNoStrategyFailure(
    proposalId: string,
    votingPowerBlock: string,
  ): Promise<void> {
    const existing = await this.deps.runRepo.findByProposalId(proposalId);
    if (existing !== undefined) return;

    await this.deps.runRepo.insertInProgress({
      proposal_id: proposalId,
      voting_power_block: votingPowerBlock,
      started_at: new Date(),
    });
    await this.deps.runRepo.markFailed(proposalId, {
      last_error: 'no_strategy_registered',
      last_attempt_at: new Date(),
    });
  }
}
