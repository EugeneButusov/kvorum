import type { Kysely } from 'kysely';
import { silentLogger, type Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  DlqRepository,
  type PgDatabase,
  ProposalRepository,
} from '@libs/db';
import { projectAaveGovernorV2Event } from './proposal-projector';
import type { AaveGovernorV2Event } from './types';
import type { AaveIpfsTitleFetcher } from '../../governance-v3/domain/ipfs-title-fetcher';
import { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import type { AaveGovernorV2ArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type AaveV2DerivationOutcome =
  | 'derived'
  | 'skipped_state_guard'
  | 'skipped_idempotent'
  | 'failed';

export type AaveV2DerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'no_proposal';

export interface AaveGovernorV2ProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: AaveV2DerivationOutcome;
    reason: AaveV2DerivationFailureReason | null;
  }): void;
  ipfsTitleFetch?(outcome: 'resolved' | 'fallback_title' | 'dlq'): void;
}

export interface AaveGovernorV2ProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: AaveGovernorV2ArchivePayloadRepository;
  ipfsFetcher: AaveIpfsTitleFetcher;
  metrics: AaveGovernorV2ProjectionMetrics;
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

const IPFS_DLQ_SOURCE = 'indexer.aave_governor_v2';

export class AaveGovernorV2ProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['aave_governor_v2'] as const;
  readonly eventTypes = [
    'ProposalCreated',
    'ProposalQueued',
    'ProposalExecuted',
    'ProposalCanceled',
  ] as const;

  private readonly logger: Logger;
  private readonly proposals: ProposalRepository;
  private readonly aaveProposals: AaveProposalRepository;

  constructor(private readonly deps: AaveGovernorV2ProjectionApplierDeps) {
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

    for (const row of rows) {
      const payload = byKey.get(tupleKey(row));
      if (payload === undefined) {
        await this.fail(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      let event: AaveGovernorV2Event;
      try {
        event = parseArchiveEvent(row.event_type, payload.payload);
      } catch (error) {
        await this.fail(row, 'decode_error', error);
        continue;
      }

      try {
        const projection = projectAaveGovernorV2Event(event, {
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
        } else {
          postCommit = await this.transaction((repositories) =>
            this.applyStateTransitionProjection(row, projection, repositories),
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
    projection: Extract<
      ReturnType<typeof projectAaveGovernorV2Event>,
      { kind: 'proposal_created' }
    >,
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
      await repositories.proposals.insertActions(result.proposalId!, projection.actions);
      await repositories.aaveProposals.insertMetadata({
        proposal_id: result.proposalId!,
        ...projection.metadata,
      });
      await repositories.proposals.ensureChoices(
        result.proposalId!,
        projection.choices.map((choice) => ({ ...choice, proposal_id: '' })),
      );
      dlqId = await insertIpfsTitleDlq(tx, row, result.proposalId!, projection.descriptionHash);
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

  private async applyStateTransitionProjection(
    row: ArchiveDerivationRow,
    projection: Extract<
      ReturnType<typeof projectAaveGovernorV2Event>,
      { kind: 'proposal_state_transition' }
    >,
    repositories: ProjectionRepositories,
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

    const advanced = await repositories.proposals.advanceState({
      daoId,
      sourceType: projection.sourceType,
      sourceId: projection.sourceId,
      targetState: projection.targetState,
      stateUpdatedAt: projection.stateUpdatedAt,
    });
    this.record(row, advanced > 0 ? 'derived' : 'skipped_state_guard', null);

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
        IPFS_DLQ_SOURCE,
      );
      this.deps.metrics.ipfsTitleFetch?.('resolved');
      return;
    }

    if (result.kind === 'no_title') {
      await this.deps.dlq.markRetrySucceeded(
        dlqId,
        'ipfs fetch completed without usable title; placeholder retained',
        IPFS_DLQ_SOURCE,
      );
      this.deps.metrics.ipfsTitleFetch?.('fallback_title');
      return;
    }

    this.deps.metrics.ipfsTitleFetch?.('dlq');
    this.logger.warn('aave_v2_ipfs_title_fetch_failed', {
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
    reason: AaveV2DerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.deps.archive.incrementAttemptCount(row.id);
    this.logger.error('aave_v2_derivation_failed', {
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
    outcome: AaveV2DerivationOutcome,
    reason: AaveV2DerivationFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseArchiveEvent(eventType: string, payloadJson: string): AaveGovernorV2Event {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  switch (eventType) {
    case 'ProposalCreated':
      return { type: 'ProposalCreated', payload: payload as never };
    case 'ProposalQueued':
      return { type: 'ProposalQueued', payload: payload as never };
    case 'ProposalExecuted':
      return { type: 'ProposalExecuted', payload: payload as never };
    case 'ProposalCanceled':
      return { type: 'ProposalCanceled', payload: payload as never };
    default:
      throw new Error(`unsupported aave governor v2 event_type ${eventType}`);
  }
}

async function insertIpfsTitleDlq(
  tx: Kysely<PgDatabase>,
  row: ArchiveDerivationRow,
  proposalId: string,
  descriptionHash: string,
): Promise<string> {
  const inserted = await tx
    .insertInto('ingestion_dlq')
    .values({
      stage: 'aave_ipfs_title_fetch',
      source: IPFS_DLQ_SOURCE,
      payload: {
        proposal_id: proposalId,
        ipfs_hash: descriptionHash,
        dao_source_id: row.dao_source_id,
      },
      error: { message: 'awaiting ipfs title fetch' },
      retries: 0,
      first_seen_at: new Date(),
      last_attempt_at: new Date(),
      archive_source_type: row.source_type,
      archive_chain_id: row.chain_id,
      archive_tx_hash: row.tx_hash,
      archive_log_index: row.log_index,
      archive_block_hash: row.block_hash,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return inserted.id;
}

function tupleKey(row: {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
}): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}
