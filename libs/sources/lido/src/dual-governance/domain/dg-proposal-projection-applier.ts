import { silentLogger, type Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  DlqRepository,
  ProposalRepository,
} from '@libs/db';
import { ArchiveFailureRouter, archiveEventTupleKey, type ProjectionDeriver } from '@sources/core';
import {
  applyUnifiedProposalState,
  buildDirectProposal,
  callsToProposalActions,
  computeCallsHash,
} from './proposal-correlator';
import type {
  DualGovernanceEvent,
  ProposalSubmittedMetaPayload,
  ProposalsCancelledTillPayload,
  TimelockProposalIdPayload,
  TimelockProposalSubmittedPayload,
} from './types';
import type { DualGovernanceProposal } from '../../persistence/schema';
import { AragonEnactmentLookup } from '../persistence/aragon-enactment-lookup';
import { DualGovernanceArchivePayloadRepository } from '../persistence/archive-payload-repository';
import { DualGovernanceProposalRepository } from '../persistence/dg-proposal-repository';
import { DualGovernanceStateHistoryRepository } from '../persistence/state-history-repository';

const DLQ_THRESHOLD = Number(process.env['DG_PROPOSAL_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const DG_PROPOSAL_PROJECTION_STAGE = 'dual_governance_proposal_projection_stage';

// DG inner calls live at proposal_action.payload_index 1 (Aragon's enactment EVMScript action, when
// present, is index 0). Uniform across correlated + direct so "DG calls = index 1" is invariant.
const DG_ACTION_PAYLOAD_INDEX = 1;

const PROPOSAL_FLOW_EVENT_TYPES = [
  'ProposalSubmitted',
  'ProposalScheduled',
  'ProposalExecuted',
  'ProposalsCancelledTill',
  'ProposalSubmittedMeta',
] as const;

type ProposalFlowEvent = Extract<
  DualGovernanceEvent,
  { type: (typeof PROPOSAL_FLOW_EVENT_TYPES)[number] }
>;

export type DualGovernanceProposalOutcome = 'derived' | 'deferred' | 'failed';
export type DualGovernanceProposalFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'meta_missing'
  | 'unknown_dao_source'
  | 'projection_apply_error';

class DgProposalApplyError extends Error {
  constructor(public readonly reason: DualGovernanceProposalFailureReason) {
    super(reason);
    this.name = 'DgProposalApplyError';
  }
}

export interface DualGovernanceProposalProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: DualGovernanceProposalOutcome;
    reason: DualGovernanceProposalFailureReason | null;
  }): void;
}

export interface DualGovernanceProposalProjectionApplierDeps {
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: DualGovernanceArchivePayloadRepository;
  proposals: ProposalRepository;
  actors: ActorRepository;
  ledger: DualGovernanceProposalRepository;
  enactment: AragonEnactmentLookup;
  // ADR-031 `vetoed` precedence: the unified-state resolver reads rage-quit episodes from here.
  history: DualGovernanceStateHistoryRepository;
  metrics: DualGovernanceProposalProjectionMetrics;
  logger?: Logger;
}

/**
 * AB3 (#330): derives the DG/Timelock proposal flow into the unified `proposal` model + the
 * `dual_governance_proposal` ledger (ADR-0074 §4). Correlates each submission to its originating Aragon
 * vote by the shared enactment tx (deterministic; verified in VERIFICATION.md), giving origin-less
 * submissions their own `proposal` row. The unified `proposal.state` is `f(ledger status)` applied via
 * the guard-bypassing `setStateFromDerivation`, so a correlated proposal's premature Aragon `executed`
 * is reclassified to `queued` and then driven forward. No escrow/reconciler work (AB4).
 */
export class DualGovernanceProposalProjectionApplier implements ProjectionDeriver {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['dual_governance'] as const;
  readonly eventTypes = PROPOSAL_FLOW_EVENT_TYPES;

  private readonly logger: Logger;
  private readonly failures: ArchiveFailureRouter;

  constructor(private readonly deps: DualGovernanceProposalProjectionApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.failures = new ArchiveFailureRouter({
      archive: deps.archive,
      dlq: deps.dlq,
      stage: DG_PROPOSAL_PROJECTION_STAGE,
      source: 'indexer.dual_governance_proposal_projection',
      logEvent: 'dual_governance_proposal_derivation_failed',
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
        await this.fail(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      let event: ProposalFlowEvent;
      try {
        event = parseProposalFlowEvent(row.event_type, payload.payload);
      } catch (error) {
        await this.fail(row, 'decode_error', error);
        continue;
      }

      try {
        const outcome = await this.handle(row, event);
        if (outcome === 'derived') await this.deps.archive.markDerived(row.id);
        this.record(row, outcome, null);
      } catch (error) {
        const reason =
          error instanceof DgProposalApplyError ? error.reason : 'projection_apply_error';
        await this.fail(row, reason, error);
      }
    }
  }

  private async handle(
    row: ArchiveDerivationRow,
    event: ProposalFlowEvent,
  ): Promise<'derived' | 'deferred'> {
    switch (event.type) {
      case 'ProposalSubmitted':
        return this.handleSubmitted(row, event.payload);
      case 'ProposalScheduled':
        return this.handleScheduled(row, event.payload);
      case 'ProposalExecuted':
        return this.handleExecuted(row, event.payload);
      case 'ProposalsCancelledTill':
        return this.handleCancelledTill(row, event.payload);
      case 'ProposalSubmittedMeta':
        // The Timelock `ProposalSubmitted` handler pulls the Meta's proposer + metadata directly, so this
        // event is a drain — the proposer actor_address is already created by the actor sweep. Reaching
        // derived_at keeps the zero-underived acceptance gate satisfied.
        return 'derived';
    }
  }

  private async handleSubmitted(
    row: ArchiveDerivationRow,
    payload: TimelockProposalSubmittedPayload,
  ): Promise<'derived' | 'deferred'> {
    const daoId = await this.requireDaoId(row);

    // Coverage gate (ADR-0074 §4): defer until the Aragon archive has reached this block, so a co-tx
    // ExecuteVote (if any) is guaranteed visible and absence means a genuine direct submission.
    if (!(await this.aragonArchiveCovers(row))) return 'deferred';

    const voteId = await this.deps.enactment.findEnactmentVoteId(row.chain_id, row.tx_hash);

    let proposalId: string;
    let origin: 'aragon' | 'direct';
    let aragonSourceId: string | null;

    if (voteId !== undefined) {
      const aragonProposal = await this.deps.proposals.findBySource({
        daoId,
        sourceType: 'aragon_voting',
        sourceId: voteId,
      });
      // Archive coverage is ahead of derivation: the StartVote-created proposal predates enactment by
      // days, but if its derivation has not landed yet, defer rather than mint a spurious direct row.
      if (aragonProposal === undefined) return 'deferred';
      proposalId = aragonProposal.id;
      origin = 'aragon';
      aragonSourceId = voteId;
    } else {
      proposalId = await this.ensureDirectProposal(row, daoId, payload);
      origin = 'direct';
      aragonSourceId = null;
    }

    const { row: ledgerRow } = await this.deps.ledger.upsertSubmission({
      dao_id: daoId,
      dg_proposal_id: payload.id,
      proposal_id: proposalId,
      origin,
      aragon_source_id: aragonSourceId,
      executor: payload.executor.toLowerCase(),
      calls_hash: computeCallsHash(payload.calls),
      submitted_tx_hash: row.tx_hash,
      submitted_block: row.block_number,
      submitted_at: row.received_at,
      status: 'submitted',
      scheduled_at: null,
      executed_at: null,
      cancelled_at: null,
      last_reconcile_check_block: null,
    });

    await this.deps.proposals.insertActions(
      proposalId,
      callsToProposalActions(payload.calls, row.chain_id),
      DG_ACTION_PAYLOAD_INDEX,
    );
    await this.setUnifiedState(ledgerRow, row.received_at);
    return 'derived';
  }

  private async ensureDirectProposal(
    row: ArchiveDerivationRow,
    daoId: string,
    payload: TimelockProposalSubmittedPayload,
  ): Promise<string> {
    const meta = await this.findCoTxMeta(row, payload.id);
    if (meta === undefined) throw new DgProposalApplyError('meta_missing');

    const proposer = await this.deps.actors.findOrCreateActorAddress(
      meta.proposerAccount,
      'proposer_event',
    );
    const draft = buildDirectProposal({
      dgProposalId: payload.id,
      metadata: meta.metadata,
      submittedBlock: row.block_number,
      submittedAt: row.received_at,
    });
    const result = await this.deps.proposals.insertProposal({
      ...draft,
      dao_id: daoId,
      proposer_actor_id: proposer.id,
    });
    if (result.inserted) return result.proposalId!;

    const existing = await this.deps.proposals.findBySource({
      daoId,
      sourceType: 'dual_governance',
      sourceId: payload.id,
    });
    // insertProposal conflicted, so the row exists; the assertion is the only way to tell TS.
    return existing!.id;
  }

  private async handleScheduled(
    row: ArchiveDerivationRow,
    payload: TimelockProposalIdPayload,
  ): Promise<'derived' | 'deferred'> {
    const daoId = await this.requireDaoId(row);
    const ledgerRow = await this.deps.ledger.markScheduled(daoId, payload.id, row.received_at);
    if (ledgerRow === undefined) return 'deferred'; // its ProposalSubmitted has not derived yet
    await this.setUnifiedState(ledgerRow, row.received_at);
    return 'derived';
  }

  private async handleExecuted(
    row: ArchiveDerivationRow,
    payload: TimelockProposalIdPayload,
  ): Promise<'derived' | 'deferred'> {
    const daoId = await this.requireDaoId(row);
    const ledgerRow = await this.deps.ledger.markExecuted(daoId, payload.id, row.received_at);
    if (ledgerRow === undefined) return 'deferred';
    await this.setUnifiedState(ledgerRow, row.received_at);
    return 'derived';
  }

  private async handleCancelledTill(
    row: ArchiveDerivationRow,
    payload: ProposalsCancelledTillPayload,
  ): Promise<'derived' | 'deferred'> {
    const daoId = await this.requireDaoId(row);
    // The bulk-cancel range covers every non-terminal proposal with id <= boundary. Defer until the
    // Aragon archive covers this block: that guarantees every in-range ProposalSubmitted (at an earlier
    // block) has cleared its own coverage gate and derived, so none is missed by the range.
    if (!(await this.aragonArchiveCovers(row))) return 'deferred';

    const cancelled = await this.deps.ledger.cancelThrough(
      daoId,
      payload.proposalId,
      row.received_at,
    );
    for (const ledgerRow of cancelled) {
      await this.setUnifiedState(ledgerRow, row.received_at);
    }
    return 'derived';
  }

  /**
   * Resolve + write the unified `proposal.state` from the ledger row, honouring ADR-031 `vetoed`
   * precedence over `f(ledger status)` (a rage-quit covering the proposal's pending window wins). Routed
   * through the shared resolver so this and the rage-quit step never diverge.
   */
  private async setUnifiedState(ledgerRow: DualGovernanceProposal, at: Date): Promise<void> {
    const rageQuitAts = await this.deps.history.rageQuitTransitionsForDao(ledgerRow.dao_id);
    await applyUnifiedProposalState(this.deps.proposals, ledgerRow, rageQuitAts, at);
  }

  private async aragonArchiveCovers(row: ArchiveDerivationRow): Promise<boolean> {
    const maxBlock = await this.deps.enactment.maxArchivedBlock(row.chain_id);
    return maxBlock !== undefined && maxBlock >= BigInt(row.block_number);
  }

  private async findCoTxMeta(
    row: ArchiveDerivationRow,
    dgProposalId: string,
  ): Promise<ProposalSubmittedMetaPayload | undefined> {
    const metas = await this.deps.payloads.findEventsInTx(
      row.chain_id,
      row.tx_hash,
      'ProposalSubmittedMeta',
    );
    for (const meta of metas) {
      const parsed = JSON.parse(meta.payload) as ProposalSubmittedMetaPayload;
      if (parsed.proposalId === dgProposalId) return parsed;
    }
    return undefined;
  }

  private async requireDaoId(row: ArchiveDerivationRow): Promise<string> {
    const daoId = await this.deps.proposals.findDaoIdForSource(row.dao_source_id);
    if (daoId === undefined) throw new DgProposalApplyError('unknown_dao_source');
    return daoId;
  }

  private async fail(
    row: ArchiveDerivationRow,
    reason: DualGovernanceProposalFailureReason,
    error: unknown,
  ): Promise<void> {
    await this.failures.route(row, reason, error);
    this.record(row, 'failed', reason);
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: DualGovernanceProposalOutcome,
    reason: DualGovernanceProposalFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseProposalFlowEvent(eventType: string, payloadJson: string): ProposalFlowEvent {
  if (!(PROPOSAL_FLOW_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new Error(`unsupported dual_governance proposal-flow event_type ${eventType}`);
  }
  const type = eventType as ProposalFlowEvent['type'];
  return { type, payload: JSON.parse(payloadJson) } as ProposalFlowEvent;
}
