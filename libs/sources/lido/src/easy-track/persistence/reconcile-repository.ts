import { sql, type Kysely } from 'kysely';
import type { PgDatabase, ProposalState } from '@libs/db';
import type {
  BaseStaleReconciliationRow,
  ReconcilableProposalRepository,
  ReconcilePerChainBound,
} from '@sources/core';

/** Candidate row for the Easy Track optimistic-pass reconcile. */
export interface EasyTrackStaleReconciliationRow extends BaseStaleReconciliationRow {
  id: string;
  source_id: string; // motion id
  source_type: string;
  chain_id: string;
  easy_track_address: string;
  state: ProposalState;
}

export interface EasyTrackReconcileStateInput {
  proposalId: string;
  expectedStates: readonly ProposalState[];
  targetState: Extract<ProposalState, 'queued'>;
  stateUpdatedAt: Date;
}

/**
 * Reconcile repo for Lido Easy Track motions.
 *
 * Candidates are still-`active` motion proposals whose recheck watermark
 * (`easy_track_motion_meta.last_reconcile_check_block`) is unset or older than the recheck gap. The
 * reconciler reads `getMotions()` and, for a motion still present past its objection window, advances
 * the proposal `active → queued` (the event-silent optimistic pass — see ADR-076). Terminal states
 * (`executed`/`defeated`/`canceled`) stay event-backed via the motion-projection deriver.
 */
export class EasyTrackReconcileRepository
  implements ReconcilableProposalRepository<EasyTrackStaleReconciliationRow>
{
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findStaleForReconciliation(
    sourceTypes: readonly string[],
    perChainBounds: readonly ReconcilePerChainBound[],
    limit: number,
  ): Promise<EasyTrackStaleReconciliationRow[]> {
    if (sourceTypes.length === 0 || perChainBounds.length === 0 || limit <= 0) return [];

    /* v8 ignore next -- integration-only: exercised against real PG in the reconcile integration spec */
    return this.db
      .selectFrom('proposal')
      .innerJoin('dao_source', (join) =>
        join
          .onRef('dao_source.dao_id', '=', 'proposal.dao_id')
          .onRef('dao_source.source_type', '=', 'proposal.source_type'),
      )
      .innerJoin('easy_track_motion_meta', 'easy_track_motion_meta.proposal_id', 'proposal.id')
      .select([
        'proposal.id',
        'proposal.source_id',
        'proposal.source_type',
        'dao_source.chain_id',
        sql<string>`dao_source.source_config ->> 'easy_track_address'`.as('easy_track_address'),
        'proposal.state',
      ])
      .where('proposal.source_type', 'in', sourceTypes)
      .where('proposal.state', '=', 'active')
      .where((eb) =>
        eb.or(
          perChainBounds.map((bound) =>
            eb.and([
              eb('dao_source.chain_id', '=', bound.chainId),
              eb.or([
                eb('easy_track_motion_meta.last_reconcile_check_block', 'is', null),
                eb(
                  'easy_track_motion_meta.last_reconcile_check_block',
                  '<',
                  String(BigInt(bound.confirmedThresholdBlock) - BigInt(bound.recheckGapBlocks)),
                ),
              ]),
            ]),
          ),
        ),
      )
      .orderBy('proposal.created_at', 'asc')
      .limit(limit)
      .execute() as Promise<EasyTrackStaleReconciliationRow[]>;
  }

  /** Guarded event-silent state write: the optimistic pass `active → queued`. */
  async reconcileState(input: EasyTrackReconcileStateInput): Promise<number> {
    const result = await this.db
      .updateTable('proposal')
      .set({
        state: input.targetState,
        state_updated_at: input.stateUpdatedAt,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', input.proposalId)
      .where('state', 'in', input.expectedStates)
      .where('state', '<>', input.targetState)
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }

  async markReconcileChecked(proposalId: string, confirmedThreshold: string): Promise<void> {
    await this.db
      .updateTable('easy_track_motion_meta')
      .set({ last_reconcile_check_block: confirmedThreshold })
      .where('proposal_id', '=', proposalId)
      .execute();
  }
}
