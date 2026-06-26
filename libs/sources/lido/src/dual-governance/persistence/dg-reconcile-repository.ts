import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type {
  BaseStaleReconciliationRow,
  ReconcilableProposalRepository,
  ReconcilePerChainBound,
} from '@sources/core';
import type { DualGovernanceState } from '../../persistence/schema';

/**
 * Reconcile candidate for the DAO-wide DG state pass — one row per DG-enabled `dao_source` (DG state is
 * a DAO property, ADR-024, not per-proposal). `id` is the `dao_id` (the driver's per-candidate key);
 * `source_id`/`dg_address`/`timelock_address` come from the dao_source config.
 */
export interface DgStaleReconciliationRow extends BaseStaleReconciliationRow {
  id: string;
  source_id: string;
  source_type: string;
  chain_id: string;
  dg_address: string;
  timelock_address: string;
}

/**
 * Candidate source + watermark for `dual_governance_reconcile`. The cursor table
 * (`dual_governance_reconcile_state`, lido_007) is upserted lazily — a DG DAO with no cursor row yet is
 * treated as "never checked" via the LEFT JOIN, so no seed row is needed.
 */
export class DualGovernanceReconcileRepository
  implements ReconcilableProposalRepository<DgStaleReconciliationRow>
{
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findStaleForReconciliation(
    sourceTypes: readonly string[],
    perChainBounds: readonly ReconcilePerChainBound[],
    limit: number,
  ): Promise<DgStaleReconciliationRow[]> {
    if (sourceTypes.length === 0 || perChainBounds.length === 0 || limit <= 0) return [];

    /* v8 ignore next -- integration-only: exercised against real PG in the reconcile integration spec */
    return this.db
      .selectFrom('dao_source')
      .leftJoin(
        'dual_governance_reconcile_state',
        'dual_governance_reconcile_state.dao_id',
        'dao_source.dao_id',
      )
      .select([
        'dao_source.dao_id as id',
        sql<string>`dao_source.source_config ->> 'dual_governance_address'`.as('source_id'),
        'dao_source.source_type',
        'dao_source.chain_id',
        sql<string>`dao_source.source_config ->> 'dual_governance_address'`.as('dg_address'),
        sql<string>`dao_source.source_config ->> 'timelock_address'`.as('timelock_address'),
      ])
      .where('dao_source.source_type', 'in', sourceTypes)
      .where((eb) =>
        eb.or(
          perChainBounds.map((bound) =>
            eb.and([
              eb('dao_source.chain_id', '=', bound.chainId),
              eb.or([
                eb('dual_governance_reconcile_state.last_reconcile_check_block', 'is', null),
                eb(
                  'dual_governance_reconcile_state.last_reconcile_check_block',
                  '<',
                  String(BigInt(bound.confirmedThresholdBlock) - BigInt(bound.recheckGapBlocks)),
                ),
              ]),
            ]),
          ),
        ),
      )
      .limit(limit)
      .execute() as Promise<DgStaleReconciliationRow[]>;
  }

  /** Lazy upsert of the per-DAO reconcile cursor + last observed effective state (drift surfacing). */
  async markReconcileChecked(
    daoId: string,
    confirmedThreshold: string,
    effectiveState: DualGovernanceState | null,
  ): Promise<void> {
    await this.db
      .insertInto('dual_governance_reconcile_state')
      .values({
        dao_id: daoId,
        last_reconcile_check_block: confirmedThreshold,
        last_effective_state: effectiveState,
      })
      .onConflict((oc) =>
        oc.column('dao_id').doUpdateSet({
          last_reconcile_check_block: confirmedThreshold,
          last_effective_state: effectiveState,
          updated_at: sql<Date>`now()`,
        }),
      )
      .execute();
  }
}
