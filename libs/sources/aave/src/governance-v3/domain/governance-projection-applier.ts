import type { Kysely } from 'kysely';
import { silentLogger, type ChainContextRegistry, type Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  DlqRepository,
  type PgDatabase,
  ProposalRepository,
} from '@libs/db';
import { VoteBlockTimestampFetcher } from '@sources/core';
import type { AaveIpfsTitleFetcher } from './ipfs-title-fetcher';
import { projectAaveGovernanceV3Event } from './proposal-projector';
import type { AaveGovernanceV3Event } from './types';
import { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import { insertIpfsTitleDlq } from '../../persistence/ipfs-title-dlq';
import type { AaveGovernanceArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type AaveDerivationOutcome =
  | 'derived'
  | 'skipped_state_guard'
  | 'skipped_idempotent'
  | 'failed';

export type AaveDerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'no_proposal'
  | 'block_timestamp_unavailable';

export interface AaveGovernanceProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: AaveDerivationOutcome;
    reason: AaveDerivationFailureReason | null;
  }): void;
  ipfsTitleFetch?(outcome: 'resolved' | 'fallback_title' | 'dlq'): void;
}

export interface AaveGovernanceProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: AaveGovernanceArchivePayloadRepository;
  ipfsFetcher: AaveIpfsTitleFetcher;
  /** Resolves the activation block's timestamp — the anchor of the derived voting window. */
  registry: ChainContextRegistry;
  metrics: AaveGovernanceProjectionMetrics;
  logger?: Logger;
}

interface ProjectionRepositories {
  actors: ActorRepository;
  proposals: ProposalRepository;
  aaveProposals: AaveProposalRepository;
  archive: ArchiveDerivationRepository;
  actorResolution: ArchiveActorResolutionRepository;
}

class ProposalNotFoundError extends Error {
  constructor(public readonly sourceId: string) {
    super(`proposal not found for source_id ${sourceId}`);
    this.name = 'ProposalNotFoundError';
  }
}

export class AaveGovernanceProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['aave_governance_v3'] as const;
  readonly eventTypes = [
    'ProposalCreated',
    'VotingActivated',
    'ProposalQueued',
    'ProposalExecuted',
    'ProposalCanceled',
    'ProposalFailed',
    'PayloadSent',
  ] as const;

  private readonly logger: Logger;
  private readonly proposals: ProposalRepository;
  private readonly aaveProposals: AaveProposalRepository;
  private readonly blockTimestamps = new VoteBlockTimestampFetcher();

  constructor(private readonly deps: AaveGovernanceProjectionApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.proposals = new ProposalRepository(deps.pgDb);
    this.aaveProposals = new AaveProposalRepository(deps.pgDb);
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;

    const lookupStartedAt = Date.now();
    const payloads = await this.deps.payloads.fetchPayloads(rows);
    this.deps.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const byKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));
    const indexedPayloadChainCache = new Map<string, boolean>();
    // Batches are mixed-event-type here (unlike the vote/payload appliers), so resolve activation
    // block times up front for just the VotingActivated rows rather than one RPC round trip each.
    const activationTimes = await this.fetchActivationTimes(rows);

    for (const row of rows) {
      const payload = byKey.get(tupleKey(row));
      if (payload === undefined) {
        await this.fail(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      let event: AaveGovernanceV3Event;
      try {
        event = parseArchiveEvent(row.event_type, payload.payload);
      } catch (error) {
        await this.fail(row, 'decode_error', error);
        continue;
      }

      try {
        const projection = projectAaveGovernanceV3Event(event, {
          id: row.id,
          dao_source_id: row.dao_source_id,
          source_type: row.source_type,
          chain_id: row.chain_id,
          block_number: row.block_number,
          confirmed_at: row.received_at,
        });

        let postCommit: () => Promise<void>;
        if (projection.kind === 'proposal_created') {
          postCommit = await this.transaction((repositories, tx) =>
            this.applyCreatedProjection(row, projection, repositories, tx),
          );
        } else if (projection.kind === 'payload_declared') {
          postCommit = await this.applyPayloadSentWithIndexCheck(
            row,
            projection,
            indexedPayloadChainCache,
          );
        } else {
          if (
            projection.kind === 'voting_activated' &&
            this.activationTimeFor(row, activationTimes) === undefined
          ) {
            await this.fail(
              row,
              'block_timestamp_unavailable',
              new Error(`block timestamp unavailable for ${String(row.block_number)}`),
            );
            continue;
          }
          postCommit = await this.transaction((repositories) =>
            this.applyNonCreateProjection(row, projection, repositories, activationTimes),
          );
        }

        await postCommit();
      } catch (error) {
        const reason =
          error instanceof ProposalNotFoundError ? 'no_proposal' : 'projection_apply_error';
        await this.fail(row, reason, error);
      }
    }
  }

  private async applyCreatedProjection(
    row: ArchiveDerivationRow,
    projection: ReturnType<typeof projectAaveGovernanceV3Event> & { kind: 'proposal_created' },
    repositories: ProjectionRepositories,
    tx: Kysely<PgDatabase>,
  ): Promise<() => Promise<void>> {
    const daoId = await repositories.proposals.findDaoIdForSource(projection.daoSourceId);
    if (daoId === undefined) throw new Error(`unknown dao_source ${projection.daoSourceId}`);

    const proposer = await repositories.actors.findOrCreateActorAddress(
      projection.proposerAddress,
      'proposer_event',
    );
    const result = await repositories.proposals.insertProposal({
      ...projection.proposal,
      dao_id: daoId,
      proposer_actor_id: proposer.id,
    });

    let dlqId: string | undefined;
    let proposalId: string | undefined;

    if (result.inserted) {
      proposalId = result.proposalId;
      await repositories.aaveProposals.insertMetadata({
        proposal_id: result.proposalId!,
        ...projection.metadata,
      });
      await repositories.proposals.ensureChoices(
        result.proposalId!,
        projection.choices.map((choice) => ({ ...choice, proposal_id: '' })),
      );
      dlqId = await insertIpfsTitleDlq(tx, row, {
        proposalId: result.proposalId!,
        descriptionHash: projection.descriptionHash,
        source: 'indexer.aave_governance_v3',
      });
      this.record(row, 'derived', null);
    } else {
      this.record(row, 'skipped_idempotent', null);
    }

    await repositories.archive.markDerived(row.id);
    await repositories.actorResolution.markActorResolved(row.id);

    return async () => {
      if (!result.inserted || dlqId === undefined || proposalId === undefined) return;
      await this.handleIpfsEnrichment(proposalId, projection.descriptionHash, dlqId);
    };
  }

  /**
   * Block times for the batch's VotingActivated rows. `received_at` cannot stand in: on a backfilled
   * row it records when the indexer ingested the event, not when the block was mined, so a
   * backfilled proposal would date its vote to the backfill run. Returns an empty map when the chain
   * has no configured context — callers surface that as `block_timestamp_unavailable` and retry
   * rather than persisting a wrong instant.
   */
  private async fetchActivationTimes(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<ReadonlyMap<string, Date>> {
    const activated = rows.filter((row) => row.event_type === 'VotingActivated');
    if (activated.length === 0) return new Map();

    const first = activated[0];
    if (first === undefined) return new Map();
    const chainCtx = this.deps.registry.peek(first.chain_id);
    if (chainCtx === undefined) return new Map();

    try {
      return await this.blockTimestamps.fetchBatch(
        chainCtx,
        activated.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash })),
      );
    } catch (error) {
      this.logger.warn('aave_activation_timestamp_fetch_failed', {
        chain_id: first.chain_id,
        rows: activated.length,
        error: String(error),
      });
      return new Map();
    }
  }

  private activationTimeFor(
    row: ArchiveDerivationRow,
    activationTimes: ReadonlyMap<string, Date>,
  ): Date | undefined {
    return activationTimes.get(this.blockTimestamps.resultKey(row.block_number, row.block_hash));
  }

  private async applyNonCreateProjection(
    row: ArchiveDerivationRow,
    projection: Exclude<
      ReturnType<typeof projectAaveGovernanceV3Event>,
      { kind: 'proposal_created' }
    >,
    repositories: ProjectionRepositories,
    activationTimes: ReadonlyMap<string, Date>,
  ): Promise<() => Promise<void>> {
    const daoId = await repositories.proposals.findDaoIdForSource(projection.daoSourceId);
    if (daoId === undefined) throw new Error(`unknown dao_source ${projection.daoSourceId}`);

    const proposal = await repositories.proposals.findBySource({
      daoId,
      sourceType: projection.sourceType,
      sourceId: projection.sourceId,
    });
    if (proposal === undefined) {
      throw new ProposalNotFoundError(projection.sourceId);
    }

    if (projection.kind === 'voting_activated') {
      const advanced = await repositories.proposals.advanceState({
        daoId,
        sourceType: projection.sourceType,
        sourceId: projection.sourceId,
        targetState: projection.targetState,
        stateUpdatedAt: projection.stateUpdatedAt,
      });

      // Derive the voting window from mainnet: activation-block time + votingDuration. This is the
      // only window available for a proposal whose voting-machine ProposalVoteStarted is not in the
      // archive (the machines' active_from_block starts after the early v3 votes). Both this and the
      // voting-machine handler write through the coalescing `fillTimestamps`, so whichever derives
      // first fills the window and the other is a no-op; in practice that is mainnet, and the two
      // differ only by the a.DI bridge relay.
      //
      // Deliberately outside the `advanced > 0` guard: re-deriving an already-terminal proposal
      // (executed/canceled) is guarded back to 0 by advanceState, and those are precisely the rows
      // that need their window filled retroactively.
      const activatedAt = this.activationTimeFor(row, activationTimes);
      if (activatedAt !== undefined) {
        await repositories.proposals.fillTimestamps([
          {
            id: proposal.id,
            voting_starts_at: activatedAt,
            voting_ends_at: new Date(activatedAt.getTime() + projection.votingDuration * 1000),
          },
        ]);
      }
      this.record(row, advanced > 0 ? 'derived' : 'skipped_state_guard', null);
    } else if (projection.kind === 'proposal_state_transition') {
      const advanced = await repositories.proposals.advanceState({
        daoId,
        sourceType: projection.sourceType,
        sourceId: projection.sourceId,
        targetState: projection.targetState,
        stateUpdatedAt: projection.stateUpdatedAt,
      });
      this.record(row, advanced > 0 ? 'derived' : 'skipped_state_guard', null);
    } else {
      await repositories.aaveProposals.insertDeclaredPayload({
        proposal_id: proposal.id,
        executed_at_destination: null,
        bridge_message_id: null,
        ...projection.payload,
      });
      this.record(row, 'derived', null);
    }

    await repositories.archive.markDerived(row.id);
    await repositories.actorResolution.markActorResolved(row.id);
    return async () => undefined;
  }

  private async applyPayloadSentWithIndexCheck(
    row: ArchiveDerivationRow,
    projection: Extract<
      ReturnType<typeof projectAaveGovernanceV3Event>,
      { kind: 'payload_declared' }
    >,
    indexedPayloadChainCache: Map<string, boolean>,
  ): Promise<() => Promise<void>> {
    const daoId = await this.proposals.findDaoIdForSource(projection.daoSourceId);
    if (daoId === undefined) throw new Error(`unknown dao_source ${projection.daoSourceId}`);

    const cacheKey = `${daoId}:${projection.payload.target_chain_id}`;
    let hasIndexedSource = indexedPayloadChainCache.get(cacheKey);
    if (hasIndexedSource === undefined) {
      hasIndexedSource = await this.aaveProposals.hasActivePayloadsControllerSource(
        daoId,
        projection.payload.target_chain_id,
      );
      indexedPayloadChainCache.set(cacheKey, hasIndexedSource);
    }

    return this.transaction((repositories) =>
      this.applyPayloadSentProjection(row, projection, daoId, !hasIndexedSource, repositories),
    );
  }

  private async applyPayloadSentProjection(
    row: ArchiveDerivationRow,
    projection: Extract<
      ReturnType<typeof projectAaveGovernanceV3Event>,
      { kind: 'payload_declared' }
    >,
    daoId: string,
    unindexedTargetChain: boolean,
    repositories: ProjectionRepositories,
  ): Promise<() => Promise<void>> {
    const proposal = await repositories.proposals.findBySource({
      daoId,
      sourceType: projection.sourceType,
      sourceId: projection.sourceId,
    });
    if (proposal === undefined) {
      throw new ProposalNotFoundError(projection.sourceId);
    }

    await repositories.aaveProposals.insertDeclaredPayload({
      proposal_id: proposal.id,
      executed_at_destination: null,
      bridge_message_id: null,
      unindexed_target_chain: unindexedTargetChain,
      ...projection.payload,
    });
    this.record(row, 'derived', null);
    await repositories.archive.markDerived(row.id);
    await repositories.actorResolution.markActorResolved(row.id);

    return async () => undefined;
  }

  private async handleIpfsEnrichment(
    proposalId: string,
    descriptionHash: string,
    dlqId: string,
  ): Promise<void> {
    const result = await this.deps.ipfsFetcher.fetchTitleDescription(descriptionHash);
    if (result.kind === 'resolved') {
      await new ProposalRepository(this.deps.pgDb).updateTitleDescription(
        proposalId,
        result.title,
        result.description,
      );
      await this.deps.dlq.markRetrySucceeded(
        dlqId,
        'ipfs title resolved during projection',
        'indexer.aave_ipfs_title_fetch',
      );
      this.deps.metrics.ipfsTitleFetch?.('resolved');
      return;
    }

    if (result.kind === 'no_title') {
      await this.deps.dlq.markRetrySucceeded(
        dlqId,
        'ipfs fetch completed without usable title; placeholder retained',
        'indexer.aave_ipfs_title_fetch',
      );
      this.deps.metrics.ipfsTitleFetch?.('fallback_title');
      return;
    }

    this.deps.metrics.ipfsTitleFetch?.('dlq');
    this.logger.warn('aave_ipfs_title_fetch_failed', {
      proposal_id: proposalId,
      dlq_id: dlqId,
      reason: result.reason,
    });
  }

  private async transaction<T>(
    fn: (repositories: ProjectionRepositories, tx: Kysely<PgDatabase>) => Promise<T>,
  ): Promise<T> {
    return this.deps.pgDb.transaction().execute((tx) =>
      fn(
        {
          actors: new ActorRepository(tx),
          proposals: new ProposalRepository(tx),
          aaveProposals: new AaveProposalRepository(tx),
          archive: new ArchiveDerivationRepository(tx),
          actorResolution: new ArchiveActorResolutionRepository(tx),
        },
        tx,
      ),
    );
  }

  private async fail(
    row: ArchiveDerivationRow,
    reason: AaveDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.deps.archive.incrementAttemptCount(row.id);
    this.logger.error('aave_derivation_failed', {
      row_id: row.id,
      source_type: row.source_type,
      event_type: row.event_type,
      chain_id: row.chain_id,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      block_hash: row.block_hash,
      attempt: row.derivation_attempt_count + 1,
      reason,
      error: String(error),
    });
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: AaveDerivationOutcome,
    reason: AaveDerivationFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseArchiveEvent(eventType: string, payloadJson: string): AaveGovernanceV3Event {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  switch (eventType) {
    case 'ProposalCreated':
      return { type: 'ProposalCreated', payload: payload as never };
    case 'VotingActivated':
      return { type: 'VotingActivated', payload: payload as never };
    case 'ProposalQueued':
      return { type: 'ProposalQueued', payload: payload as never };
    case 'ProposalExecuted':
      return { type: 'ProposalExecuted', payload: payload as never };
    case 'ProposalCanceled':
      return { type: 'ProposalCanceled', payload: payload as never };
    case 'ProposalFailed':
      return { type: 'ProposalFailed', payload: payload as never };
    case 'PayloadSent':
      return { type: 'PayloadSent', payload: payload as never };
    default:
      throw new Error(`unsupported aave event_type ${eventType}`);
  }
}

function tupleKey(row: {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
}): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}
