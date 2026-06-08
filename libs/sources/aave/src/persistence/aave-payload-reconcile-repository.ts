import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type {
  BaseStaleReconciliationRow,
  ReconcilePerChainBound,
  ReconcilableProposalRepository,
} from '@sources/core';
import type { AavePayloadStatus } from './schema';

export interface AavePayloadStaleReconciliationRow extends BaseStaleReconciliationRow {
  payloads_controller_address: string;
  payload_id: string;
  status: Extract<AavePayloadStatus, 'created' | 'queued'>;
}

export class AavePayloadReconcileRepository
  implements ReconcilableProposalRepository<AavePayloadStaleReconciliationRow>
{
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findStaleForReconciliation(
    sourceTypes: readonly string[],
    perChainBounds: readonly ReconcilePerChainBound[],
    limit: number,
  ): Promise<AavePayloadStaleReconciliationRow[]> {
    if (sourceTypes.length === 0 || perChainBounds.length === 0 || limit <= 0) return [];

    return this.db
      .selectFrom('aave_proposal_payload')
      .select([
        'id',
        'payload_id as source_id',
        sql<string>`'aave_payloads_controller'`.as('source_type'),
        'target_chain_id as chain_id',
        'payloads_controller_address',
        'payload_id',
        'status',
      ])
      .where(sql<boolean>`'aave_payloads_controller' = any(${sourceTypes})`)
      .where('status', 'in', ['created', 'queued'])
      .where('unindexed_target_chain', '=', false)
      .where((eb) =>
        eb.or(
          perChainBounds.map((bound) =>
            eb.and([
              eb('target_chain_id', '=', bound.chainId),
              eb.or([
                eb('last_reconcile_check_block', 'is', null),
                eb(
                  'last_reconcile_check_block',
                  '<',
                  String(BigInt(bound.confirmedThresholdBlock) - BigInt(bound.recheckGapBlocks)),
                ),
              ]),
            ]),
          ),
        ),
      )
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute() as Promise<AavePayloadStaleReconciliationRow[]>;
  }

  async expirePayload(id: string): Promise<number> {
    const result = await this.db
      .updateTable('aave_proposal_payload')
      .set({ status: 'expired' })
      .where('id', '=', id)
      .where('status', 'in', ['created', 'queued'])
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }

  async markPayloadReconcileChecked(id: string, confirmedThreshold: string): Promise<void> {
    await this.db
      .updateTable('aave_proposal_payload')
      .set({ last_reconcile_check_block: confirmedThreshold })
      .where('id', '=', id)
      .execute();
  }
}
