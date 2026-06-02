import type { NewProposal, ProposalState } from '@libs/db';
import { AAVE_V3_CHOICES, type AaveProposalChoiceTemplate } from './choices';
import type {
  AaveGovernanceV3Event,
  PayloadSentPayload,
  ProposalCreatedPayload,
  VotingActivatedPayload,
} from './types';

export interface AaveProjectionArchiveRow {
  id: string;
  dao_source_id: string;
  source_type: string;
  chain_id: string;
  block_number: string;
  confirmed_at: Date | null;
}

export type AaveProposalWithoutResolvedRefs = Omit<NewProposal, 'dao_id' | 'proposer_actor_id'>;

export interface AaveProposalCreatedProjection {
  kind: 'proposal_created';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  proposerAddress: string;
  descriptionHash: string;
  proposal: AaveProposalWithoutResolvedRefs;
  metadata: {
    voting_chain_id: null;
    voting_machine_address: null;
    voting_strategy_address: null;
    snapshot_block_hash: null;
    snapshot_block_number_l1: null;
    creation_block: string;
  };
  choices: readonly AaveProposalChoiceTemplate[];
}

export interface AaveVotingActivatedProjection {
  kind: 'voting_activated';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  snapshotBlockHash: string;
  targetState: Extract<ProposalState, 'active'>;
  stateUpdatedAt: Date;
}

export interface AaveProposalStateTransitionProjection {
  kind: 'proposal_state_transition';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  targetState: Extract<ProposalState, 'queued' | 'executed' | 'canceled' | 'defeated'>;
  stateUpdatedAt: Date;
}

export interface AavePayloadDeclaredProjection {
  kind: 'payload_declared';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  payload: {
    payload_index: number;
    target_chain_id: string;
    payloads_controller_address: string;
    payload_id: string;
    status: 'declared';
  };
}

export type AaveProposalProjection =
  | AaveProposalCreatedProjection
  | AaveVotingActivatedProjection
  | AaveProposalStateTransitionProjection
  | AavePayloadDeclaredProjection;

export class AaveProposalProjectionError extends Error {
  constructor(
    public readonly reason: 'missing_confirmed_at' | 'invalid_payload_index',
    public readonly archiveRowId: string,
  ) {
    super(`aave proposal projection failed: ${reason}`);
    this.name = 'AaveProposalProjectionError';
  }
}

export function projectAaveGovernanceV3Event(
  event: AaveGovernanceV3Event,
  archiveRow: AaveProjectionArchiveRow,
): AaveProposalProjection {
  const confirmedAt = requireConfirmedAt(archiveRow);

  switch (event.type) {
    case 'ProposalCreated':
      return projectProposalCreated(event.payload, archiveRow, confirmedAt);
    case 'VotingActivated':
      return projectVotingActivated(event.payload, archiveRow, confirmedAt);
    case 'ProposalQueued':
      return projectStateTransition(event.payload.proposalId, 'queued', archiveRow, confirmedAt);
    case 'ProposalExecuted':
      return projectStateTransition(event.payload.proposalId, 'executed', archiveRow, confirmedAt);
    case 'ProposalCanceled':
      return projectStateTransition(event.payload.proposalId, 'canceled', archiveRow, confirmedAt);
    case 'ProposalFailed':
      return projectStateTransition(event.payload.proposalId, 'defeated', archiveRow, confirmedAt);
    case 'PayloadSent':
      return projectPayloadDeclared(event.payload, archiveRow);
  }
}

function projectProposalCreated(
  payload: ProposalCreatedPayload,
  archiveRow: AaveProjectionArchiveRow,
  confirmedAt: Date,
): AaveProposalCreatedProjection {
  const descriptionHash = payload.ipfsHash.replace(/^0x/, '').toLowerCase();

  return {
    kind: 'proposal_created',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    sourceId: payload.proposalId,
    proposerAddress: payload.creator.toLowerCase(),
    descriptionHash,
    proposal: {
      source_type: archiveRow.source_type,
      source_id: payload.proposalId,
      title: `Proposal #${payload.proposalId}`,
      description: '',
      description_hash: descriptionHash,
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: null,
      voting_ends_block: null,
      // Epic V3 overwrites this placeholder with the resolved L1 snapshot block number.
      voting_power_block: archiveRow.block_number,
      state: 'pending',
      state_updated_at: confirmedAt,
      updated_at: confirmedAt,
    },
    metadata: {
      voting_chain_id: null,
      voting_machine_address: null,
      voting_strategy_address: null,
      snapshot_block_hash: null,
      snapshot_block_number_l1: null,
      creation_block: archiveRow.block_number,
    },
    choices: AAVE_V3_CHOICES,
  };
}

function projectVotingActivated(
  payload: VotingActivatedPayload,
  archiveRow: AaveProjectionArchiveRow,
  confirmedAt: Date,
): AaveVotingActivatedProjection {
  return {
    kind: 'voting_activated',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    sourceId: payload.proposalId,
    snapshotBlockHash: payload.snapshotBlockHash,
    targetState: 'active',
    stateUpdatedAt: confirmedAt,
  };
}

function projectStateTransition(
  sourceId: string,
  targetState: Extract<ProposalState, 'queued' | 'executed' | 'canceled' | 'defeated'>,
  archiveRow: AaveProjectionArchiveRow,
  confirmedAt: Date,
): AaveProposalStateTransitionProjection {
  return {
    kind: 'proposal_state_transition',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    sourceId,
    targetState,
    stateUpdatedAt: confirmedAt,
  };
}

function projectPayloadDeclared(
  payload: PayloadSentPayload,
  archiveRow: AaveProjectionArchiveRow,
): AavePayloadDeclaredProjection {
  const payloadIndex = Number(payload.payloadNumberOnProposal);
  if (!Number.isSafeInteger(payloadIndex)) {
    throw new AaveProposalProjectionError('invalid_payload_index', archiveRow.id);
  }

  return {
    kind: 'payload_declared',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    sourceId: payload.proposalId,
    payload: {
      payload_index: payloadIndex,
      target_chain_id: payload.chainId,
      payloads_controller_address: payload.payloadsController.toLowerCase(),
      payload_id: payload.payloadId,
      status: 'declared',
    },
  };
}

function requireConfirmedAt(archiveRow: AaveProjectionArchiveRow): Date {
  if (archiveRow.confirmed_at === null) {
    throw new AaveProposalProjectionError('missing_confirmed_at', archiveRow.id);
  }

  return archiveRow.confirmed_at;
}
