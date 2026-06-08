import { type Kysely, sql } from 'kysely';
import type { PgDatabase, ProposalState } from '@libs/db';
import type {
  BaseStaleReconciliationRow,
  ReconcilePerChainBound,
  ReconcilableProposalRepository,
} from '@sources/core';
import type { AavePayloadStatus, NewAaveProposalMetadata, NewAaveProposalPayload } from './schema';

export interface AaveStaleReconciliationRow extends BaseStaleReconciliationRow {
  governance_address: string;
  state: ProposalState;
  creation_block: string;
}

export interface AaveReconcileStateInput {
  proposalId: string;
  expectedStates: readonly ProposalState[];
  targetState: Extract<ProposalState, 'expired'>;
  stateUpdatedAt: Date;
}

export interface FindDeclaredPayloadInput {
  targetChainId: string;
  payloadsControllerAddress: string;
  payloadId: string;
}

export interface AdvancePayloadStatusInput {
  id: string;
  targetStatus: Exclude<AavePayloadStatus, 'expired'>;
  allowedFrom: readonly AavePayloadStatus[];
  executedAtDestination?: Date;
}

export class AaveProposalRepository
  implements ReconcilableProposalRepository<AaveStaleReconciliationRow>
{
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async insertMetadata(row: NewAaveProposalMetadata): Promise<void> {
    await this.db
      .insertInto('aave_proposal_metadata')
      .values(row)
      .onConflict((oc) => oc.column('proposal_id').doNothing())
      .execute();
  }

  async setSnapshotBlockHash(proposalId: string, snapshotBlockHash: string): Promise<void> {
    await this.db
      .updateTable('aave_proposal_metadata')
      .set({ snapshot_block_hash: snapshotBlockHash })
      .where('proposal_id', '=', proposalId)
      .execute();
  }

  async setVotingChainBinding(
    proposalId: string,
    input: { votingChainId: string; votingMachineAddress: string },
  ): Promise<void> {
    await this.db
      .updateTable('aave_proposal_metadata')
      .set({
        voting_chain_id: input.votingChainId,
        voting_machine_address: input.votingMachineAddress,
      })
      .where('proposal_id', '=', proposalId)
      .where('voting_chain_id', 'is', null)
      .execute();
  }

  async findVotingMachineAddress(daoSourceId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('dao_source')
      .select(sql<string>`source_config ->> 'voting_machine_address'`.as('voting_machine_address'))
      .where('id', '=', daoSourceId)
      .executeTakeFirst();

    return row?.voting_machine_address;
  }

  async findPayloadsControllerAddress(daoSourceId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('dao_source')
      .select(
        sql<string>`lower(source_config ->> 'payloads_controller_address')`.as(
          'payloads_controller_address',
        ),
      )
      .where('id', '=', daoSourceId)
      .executeTakeFirst();

    return row?.payloads_controller_address;
  }

  async hasActivePayloadsControllerSource(daoId: string, targetChainId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('dao_source')
      .select(sql<boolean>`true`.as('present'))
      .where('dao_id', '=', daoId)
      .where('source_type', '=', 'aave_payloads_controller')
      .where('chain_id', '=', targetChainId)
      .executeTakeFirst();

    return row?.present === true;
  }

  async insertDeclaredPayload(row: NewAaveProposalPayload): Promise<void> {
    await this.db
      .insertInto('aave_proposal_payload')
      .values(row)
      .onConflict((oc) => oc.columns(['proposal_id', 'payload_index']).doNothing())
      .execute();
  }

  async findDeclaredPayload(input: FindDeclaredPayloadInput): Promise<
    | {
        id: string;
        proposal_id: string;
        payload_index: number;
        status: AavePayloadStatus;
      }
    | undefined
  > {
    return this.db
      .selectFrom('aave_proposal_payload')
      .select(['id', 'proposal_id', 'payload_index', 'status'])
      .where('target_chain_id', '=', input.targetChainId)
      .where('payloads_controller_address', '=', input.payloadsControllerAddress.toLowerCase())
      .where('payload_id', '=', input.payloadId)
      .executeTakeFirst();
  }

  async advancePayloadStatus(input: AdvancePayloadStatusInput): Promise<number> {
    const result = await this.db
      .updateTable('aave_proposal_payload')
      .set({
        status: input.targetStatus,
        executed_at_destination: input.executedAtDestination,
      })
      .where('id', '=', input.id)
      .where('status', 'in', input.allowedFrom)
      .where('status', '<>', input.targetStatus)
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }

  async findStaleForReconciliation(
    sourceTypes: readonly string[],
    perChainBounds: readonly ReconcilePerChainBound[],
    limit: number,
  ): Promise<AaveStaleReconciliationRow[]> {
    if (sourceTypes.length === 0 || perChainBounds.length === 0 || limit <= 0) return [];

    return this.db
      .selectFrom('proposal')
      .innerJoin('dao_source', (join) =>
        join
          .onRef('dao_source.dao_id', '=', 'proposal.dao_id')
          .onRef('dao_source.source_type', '=', 'proposal.source_type'),
      )
      .innerJoin('aave_proposal_metadata', 'aave_proposal_metadata.proposal_id', 'proposal.id')
      .select([
        'proposal.id',
        'proposal.source_id',
        'proposal.source_type',
        'dao_source.chain_id',
        sql<string>`dao_source.source_config ->> 'governance_address'`.as('governance_address'),
        'proposal.state',
        'aave_proposal_metadata.creation_block',
      ])
      .where('proposal.source_type', 'in', sourceTypes)
      .where('proposal.state', 'in', ['pending', 'active', 'queued'])
      .where((eb) =>
        eb.or(
          perChainBounds.map((bound) =>
            eb.and([
              eb('dao_source.chain_id', '=', bound.chainId),
              eb.or([
                eb('aave_proposal_metadata.last_reconcile_check_block', 'is', null),
                eb(
                  'aave_proposal_metadata.last_reconcile_check_block',
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
      .execute() as Promise<AaveStaleReconciliationRow[]>;
  }

  async reconcileState(input: AaveReconcileStateInput): Promise<number> {
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
      .updateTable('aave_proposal_metadata')
      .set({ last_reconcile_check_block: confirmedThreshold })
      .where('proposal_id', '=', proposalId)
      .execute();
  }
}
