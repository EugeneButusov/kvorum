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
import { ArchiveFailureRouter, archiveEventTupleKey } from '@sources/core';
import { projectAragonProposalEvent } from './proposal-projector';
import type { AragonVotingEvent } from './types';
import { AragonProposalRepository } from '../persistence/aragon-proposal-repository';
import type { AragonVotingArchivePayloadRepository } from '../persistence/archive-payload-repository';

const DLQ_THRESHOLD = Number(process.env['PROPOSAL_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const PROPOSAL_PROJECTION_STAGE = 'proposal_projection_stage';

export type AragonProposalDerivationOutcome =
  | 'derived'
  | 'skipped_idempotent'
  | 'skipped_state_guard'
  | 'skipped_config'
  | 'failed';

export type AragonProposalDerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error';

export interface AragonProposalProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: AragonProposalDerivationOutcome;
    reason: AragonProposalDerivationFailureReason | null;
  }): void;
}

export interface AragonProposalProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: AragonVotingArchivePayloadRepository;
  metrics: AragonProposalProjectionMetrics;
  logger?: Logger;
}

interface ProjectionRepositories {
  actors: ActorRepository;
  proposals: ProposalRepository;
  aragonProposals: AragonProposalRepository;
  archive: ArchiveDerivationRepository;
  actorResolution: ArchiveActorResolutionRepository;
}

/**
 * Projects Lido Aragon proposal-lifecycle + config events into PG.
 *
 *  - StartVote  → insert `proposal` (state `active`) + `aragon_proposal_metadata`
 *    seed (`app_address`; pct/phase-end-times left NULL) + binary [No, Yes] choices.
 *  - ExecuteVote → advance state to `executed` + stamp metadata.executed_at.
 *  - Change*    → no-op drain (mark derived; the global config is consumed by the
 *    state reconciler via getVote, not here).
 *
 * Event-only: no contract-state reads. The execution script lives in no archive
 * event, so `proposal_action` rows and the per-vote pct/phase-end-times are filled
 * by the getVote state reconciler, not this applier.
 */
export class AragonProposalProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['aragon_voting'] as const;
  readonly eventTypes = [
    'StartVote',
    'ExecuteVote',
    'ChangeSupportRequired',
    'ChangeMinQuorum',
    'ChangeVoteTime',
    'ChangeObjectionPhaseTime',
  ] as const;

  private readonly logger: Logger;
  private readonly failures: ArchiveFailureRouter;

  constructor(private readonly deps: AragonProposalProjectionApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.failures = new ArchiveFailureRouter({
      archive: deps.archive,
      dlq: deps.dlq,
      stage: PROPOSAL_PROJECTION_STAGE,
      source: 'indexer.proposal_projection',
      logEvent: 'aragon_proposal_derivation_failed',
      threshold: DLQ_THRESHOLD,
      logger: this.logger,
    });
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;

    const lookupStartedAt = Date.now();
    const payloads = await this.deps.payloads.fetchPayloads(rows);
    this.deps.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const byKey = new Map(payloads.map((payload) => [archiveEventTupleKey(payload), payload]));

    for (const row of rows) {
      const payload = byKey.get(archiveEventTupleKey(row));
      if (payload === undefined) {
        await this.failAndMaybeDlq(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      let event: AragonVotingEvent;
      try {
        event = parseArchiveEvent(row.event_type, payload.payload);
      } catch (error) {
        await this.failAndMaybeDlq(row, 'decode_error', error);
        continue;
      }

      try {
        await this.apply(row, event);
      } catch (error) {
        await this.failAndMaybeDlq(row, 'projection_apply_error', error);
      }
    }
  }

  private async apply(row: ArchiveDerivationRow, event: AragonVotingEvent): Promise<void> {
    const projection = projectAragonProposalEvent(event, {
      id: row.id,
      dao_source_id: row.dao_source_id,
      source_type: row.source_type,
      chain_id: row.chain_id,
      block_number: row.block_number,
      confirmed_at: row.received_at,
    });

    await this.transaction(async (repos) => {
      if (projection.kind === 'config_noop') {
        this.record(row, 'skipped_config', null);
        await repos.archive.markDerived(row.id);
        await repos.actorResolution.markActorResolved(row.id);
        return;
      }

      const daoId = await repos.proposals.findDaoIdForSource(projection.daoSourceId);
      if (daoId === undefined) throw new Error(`unknown dao_source ${projection.daoSourceId}`);

      if (projection.kind === 'proposal_created') {
        const creator = await repos.actors.findOrCreateActorAddress(
          projection.creatorAddress,
          'proposer_event',
        );
        const result = await repos.proposals.insertProposal({
          ...projection.proposal,
          dao_id: daoId,
          proposer_actor_id: creator.id,
        });

        if (result.inserted) {
          const appAddress = await repos.aragonProposals.findVotingAddress(projection.daoSourceId);
          if (appAddress === undefined) {
            throw new Error(
              `missing voting_address in dao_source config ${projection.daoSourceId}`,
            );
          }
          await repos.aragonProposals.insertMetadata({
            proposal_id: result.proposalId!,
            app_address: appAddress,
            app_version: null,
            support_required_pct: null,
            min_accept_quorum_pct: null,
            main_phase_ends_at: null,
            objection_phase_ends_at: null,
            executed_at: null,
            last_reconcile_check_block: null,
          });
          await repos.proposals.ensureChoices(result.proposalId!, projection.choices);
          this.record(row, 'derived', null);
        } else {
          this.record(row, 'skipped_idempotent', null);
        }
      } else {
        const advanced = await repos.proposals.advanceState({
          daoId,
          sourceType: projection.sourceType,
          sourceId: projection.sourceId,
          targetState: projection.targetState,
          stateUpdatedAt: projection.stateUpdatedAt,
        });
        if (advanced > 0) {
          const proposal = await repos.proposals.findBySource({
            daoId,
            sourceType: projection.sourceType,
            sourceId: projection.sourceId,
          });
          if (proposal !== undefined) {
            await repos.aragonProposals.setExecutedAt(proposal.id, projection.executedAt);
          }
        }
        this.record(row, advanced > 0 ? 'derived' : 'skipped_state_guard', null);
      }

      await repos.archive.markDerived(row.id);
      await repos.actorResolution.markActorResolved(row.id);
    });
  }

  private async transaction(fn: (repos: ProjectionRepositories) => Promise<void>): Promise<void> {
    return this.deps.pgDb.transaction().execute((tx) =>
      fn({
        actors: new ActorRepository(tx),
        proposals: new ProposalRepository(tx),
        aragonProposals: new AragonProposalRepository(tx),
        archive: new ArchiveDerivationRepository(tx),
        actorResolution: new ArchiveActorResolutionRepository(tx),
      }),
    );
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: AragonProposalDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.failures.route(row, reason, error);
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: AragonProposalDerivationOutcome,
    reason: AragonProposalDerivationFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseArchiveEvent(eventType: string, payloadJson: string): AragonVotingEvent {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  switch (eventType) {
    case 'StartVote':
      return { type: 'StartVote', payload: payload as never };
    case 'ExecuteVote':
      return { type: 'ExecuteVote', payload: payload as never };
    case 'ChangeSupportRequired':
      return { type: 'ChangeSupportRequired', payload: payload as never };
    case 'ChangeMinQuorum':
      return { type: 'ChangeMinQuorum', payload: payload as never };
    case 'ChangeVoteTime':
      return { type: 'ChangeVoteTime', payload: payload as never };
    case 'ChangeObjectionPhaseTime':
      return { type: 'ChangeObjectionPhaseTime', payload: payload as never };
    default:
      throw new Error(`unsupported aragon proposal event_type ${eventType}`);
  }
}
