import { sql, type Kysely } from 'kysely';
import type { PgDatabase, ProposalState } from '@libs/db';
import type {
  BaseStaleReconciliationRow,
  ReconcilableProposalRepository,
  ReconcilePerChainBound,
} from '@sources/core';
import type { NewAragonProposalMetadata } from '../../persistence/schema';

/** Candidate row for the getVote reconcile/enrich pass. */
export interface AragonStaleReconciliationRow extends BaseStaleReconciliationRow {
  id: string;
  source_id: string;
  source_type: string;
  chain_id: string;
  voting_address: string;
  state: ProposalState;
  /** NULL until the reconciler fills support/quorum — the enrich-once signal. */
  support_required_pct: string | null;
}

export interface AragonReconcileStateInput {
  proposalId: string;
  expectedStates: readonly ProposalState[];
  targetState: Extract<ProposalState, 'succeeded' | 'defeated'>;
  stateUpdatedAt: Date;
}

/**
 * Per-source PG extension repo for Lido Aragon proposals.
 *
 * The event-only projection seeds the metadata row at StartVote (`app_address`;
 * pct/phase-times left NULL) and stamps `executed_at` on ExecuteVote. The getVote
 * state reconciler fills `support_required_pct`/`min_accept_quorum_pct`, advances
 * event-silent `succeeded`/`defeated`, and drives `last_reconcile_check_block`.
 * (Phase-end-times are a follow-up — they need per-vote-era config.)
 */
export class AragonProposalRepository
  implements ReconcilableProposalRepository<AragonStaleReconciliationRow>
{
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** The Aragon Voting app address from the dao_source config (= the ingester's
   *  `voting_address`). Config-driven so it can't drift from a hardcoded constant. */
  async findVotingAddress(daoSourceId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('dao_source')
      .select(sql<string | null>`source_config ->> 'voting_address'`.as('voting_address'))
      .where('id', '=', daoSourceId)
      .executeTakeFirst();

    return row?.voting_address ?? undefined;
  }

  async insertMetadata(row: NewAragonProposalMetadata): Promise<void> {
    await this.db
      .insertInto('aragon_proposal_metadata')
      .values(row)
      .onConflict((oc) => oc.column('proposal_id').doNothing())
      .execute();
  }

  async setExecutedAt(proposalId: string, executedAt: Date): Promise<void> {
    await this.db
      .updateTable('aragon_proposal_metadata')
      .set({ executed_at: executedAt })
      .where('proposal_id', '=', proposalId)
      .execute();
  }

  /**
   * Candidates for getVote reconcile/enrich: still-active proposals (need state
   * classification) OR any proposal whose pct is unfilled (needs one enrich pass —
   * catches fast-closed/executed votes too), gated by the recheck watermark.
   */
  async findStaleForReconciliation(
    sourceTypes: readonly string[],
    perChainBounds: readonly ReconcilePerChainBound[],
    limit: number,
  ): Promise<AragonStaleReconciliationRow[]> {
    if (sourceTypes.length === 0 || perChainBounds.length === 0 || limit <= 0) return [];

    /* v8 ignore next -- integration-only: exercised against real PG in the reconcile integration spec */
    return this.db
      .selectFrom('proposal')
      .innerJoin('dao_source', (join) =>
        join
          .onRef('dao_source.dao_id', '=', 'proposal.dao_id')
          .onRef('dao_source.source_type', '=', 'proposal.source_type'),
      )
      .innerJoin('aragon_proposal_metadata', 'aragon_proposal_metadata.proposal_id', 'proposal.id')
      .select([
        'proposal.id',
        'proposal.source_id',
        'proposal.source_type',
        'dao_source.chain_id',
        sql<string>`dao_source.source_config ->> 'voting_address'`.as('voting_address'),
        'proposal.state',
        'aragon_proposal_metadata.support_required_pct',
      ])
      .where('proposal.source_type', 'in', sourceTypes)
      .where((eb) =>
        eb.or([
          eb('proposal.state', '=', 'active'),
          eb('aragon_proposal_metadata.support_required_pct', 'is', null),
        ]),
      )
      .where((eb) =>
        eb.or(
          perChainBounds.map((bound) =>
            eb.and([
              eb('dao_source.chain_id', '=', bound.chainId),
              eb.or([
                eb('aragon_proposal_metadata.last_reconcile_check_block', 'is', null),
                eb(
                  'aragon_proposal_metadata.last_reconcile_check_block',
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
      .execute() as Promise<AragonStaleReconciliationRow[]>;
  }

  /** Guarded event-silent state write (succeeded/defeated at vote close). */
  async reconcileState(input: AragonReconcileStateInput): Promise<number> {
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
      .updateTable('aragon_proposal_metadata')
      .set({ last_reconcile_check_block: confirmedThreshold })
      .where('proposal_id', '=', proposalId)
      .execute();
  }

  /**
   * Write-once fill of the PCT_BASE(10^18)-scaled support/quorum from getVote.
   * COALESCE-guarded so a re-run never clobbers a filled value; the pct becoming
   * non-null is the enrich-once signal for findStaleForReconciliation.
   */
  async fillSupportQuorum(
    proposalId: string,
    values: { supportRequiredPct: string; minAcceptQuorumPct: string },
  ): Promise<void> {
    await this.db
      .updateTable('aragon_proposal_metadata')
      .set({
        support_required_pct: sql`coalesce(support_required_pct, ${values.supportRequiredPct})`,
        min_accept_quorum_pct: sql`coalesce(min_accept_quorum_pct, ${values.minAcceptQuorumPct})`,
      })
      .where('proposal_id', '=', proposalId)
      .execute();
  }
}
