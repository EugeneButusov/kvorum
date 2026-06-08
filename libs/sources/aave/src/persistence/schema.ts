import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { PgDatabase } from '@libs/db';

export type AavePayloadStatus =
  | 'declared'
  | 'created'
  | 'queued'
  | 'executed'
  | 'cancelled'
  | 'expired';

export interface AaveProposalMetadataTable {
  proposal_id: string;
  voting_chain_id: string | null;
  voting_machine_address: string | null;
  voting_strategy_address: string | null;
  snapshot_block_hash: string | null;
  // pg driver returns bigint as string
  snapshot_block_number_l1: string | null;
  // pg driver returns bigint as string
  creation_block: string;
  // pg driver returns bigint as string
  last_reconcile_check_block: string | null;
  created_at: Generated<Date>;
}

export type AaveProposalMetadata = Selectable<AaveProposalMetadataTable>;
export type NewAaveProposalMetadata = Insertable<AaveProposalMetadataTable>;
export type AaveProposalMetadataUpdate = Updateable<AaveProposalMetadataTable>;

export interface AaveProposalPayloadTable {
  id: Generated<string>;
  proposal_id: string;
  payload_index: number;
  target_chain_id: string;
  payloads_controller_address: string;
  // pg driver returns bigint as string
  payload_id: string;
  status: Generated<AavePayloadStatus>;
  executed_at_destination: Date | null;
  bridge_message_id: string | null;
  unindexed_target_chain: Generated<boolean>;
  // pg driver returns bigint as string
  last_reconcile_check_block: string | null;
  created_at: Generated<Date>;
}

export type AaveProposalPayload = Selectable<AaveProposalPayloadTable>;
export type NewAaveProposalPayload = Insertable<AaveProposalPayloadTable>;
export type AaveProposalPayloadUpdate = Updateable<AaveProposalPayloadTable>;

declare module '@libs/db' {
  interface PgDatabase {
    aave_proposal_metadata: AaveProposalMetadataTable;
    aave_proposal_payload: AaveProposalPayloadTable;
  }
}

type _AugmentationActiveCheck = PgDatabase['aave_proposal_metadata'];
