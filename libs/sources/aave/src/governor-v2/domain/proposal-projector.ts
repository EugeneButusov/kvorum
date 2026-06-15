import type { NewProposal, ProposalState } from '@libs/db';
import { AAVE_V2_CHOICES, type AaveV2ProposalChoiceTemplate } from './choices';
import type { AaveGovernorV2Event, V2ProposalCreatedPayload } from './types';

export interface V2ProjectionArchiveRow {
  id: string;
  dao_source_id: string;
  source_type: string;
  chain_id: string;
  block_number: string;
  confirmed_at: Date | null;
}

export type V2ProposalWithoutResolvedRefs = Omit<NewProposal, 'dao_id' | 'proposer_actor_id'>;

export interface V2ProposalCreatedProjection {
  kind: 'proposal_created';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  proposerAddress: string;
  descriptionHash: string;
  proposal: V2ProposalWithoutResolvedRefs;
  actions: Array<{
    targetAddress: string;
    targetChainId: string;
    valueWei: string;
    functionSignature: string;
    calldata: string;
  }>;
  metadata: {
    voting_chain_id: '0x1';
    voting_machine_address: null;
    voting_strategy_address: string;
    creation_block: string;
  };
  choices: readonly AaveV2ProposalChoiceTemplate[];
}

export interface V2ProposalStateTransitionProjection {
  kind: 'proposal_state_transition';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  targetState: Extract<ProposalState, 'queued' | 'executed' | 'canceled'>;
  stateUpdatedAt: Date;
}

export type AaveGovernorV2Projection =
  | V2ProposalCreatedProjection
  | V2ProposalStateTransitionProjection;

export class V2ProposalProjectionError extends Error {
  constructor(
    public readonly reason: 'missing_confirmed_at' | 'created_payload_array_length_mismatch',
    public readonly archiveRowId: string,
  ) {
    super(`aave governor v2 proposal projection failed: ${reason}`);
    this.name = 'V2ProposalProjectionError';
  }
}

export function projectAaveGovernorV2Event(
  event: AaveGovernorV2Event,
  archiveRow: V2ProjectionArchiveRow,
): AaveGovernorV2Projection {
  const confirmedAt = requireConfirmedAt(archiveRow);

  switch (event.type) {
    case 'ProposalCreated':
      return projectProposalCreated(event.payload, archiveRow, confirmedAt);
    case 'ProposalQueued':
      return projectStateTransition(event.payload.id, 'queued', archiveRow, confirmedAt);
    case 'ProposalExecuted':
      return projectStateTransition(event.payload.id, 'executed', archiveRow, confirmedAt);
    case 'ProposalCanceled':
      return projectStateTransition(event.payload.id, 'canceled', archiveRow, confirmedAt);
    case 'VoteEmitted':
      throw new Error('projectAaveGovernorV2Event: VoteEmitted is not a proposal lifecycle event');
  }
}

function projectProposalCreated(
  payload: V2ProposalCreatedPayload,
  archiveRow: V2ProjectionArchiveRow,
  confirmedAt: Date,
): V2ProposalCreatedProjection {
  if (
    payload.values.length !== payload.targets.length ||
    payload.signatures.length !== payload.targets.length ||
    payload.calldatas.length !== payload.targets.length
  ) {
    throw new V2ProposalProjectionError('created_payload_array_length_mismatch', archiveRow.id);
  }

  const descriptionHash = payload.ipfsHash.replace(/^0x/, '').toLowerCase();

  return {
    kind: 'proposal_created',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    sourceId: payload.id,
    proposerAddress: payload.creator.toLowerCase(),
    descriptionHash,
    proposal: {
      source_type: archiveRow.source_type,
      source_id: payload.id,
      title: `Proposal #${payload.id}`,
      description: '',
      description_hash: descriptionHash,
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: payload.startBlock,
      voting_ends_block: payload.endBlock,
      state: 'pending',
      state_updated_at: confirmedAt,
      updated_at: confirmedAt,
    },
    actions: payload.targets.map((targetAddress, index) => ({
      targetAddress,
      targetChainId: archiveRow.chain_id,
      valueWei: payload.values[index]!,
      functionSignature: payload.signatures[index]!,
      calldata: payload.calldatas[index]!,
    })),
    metadata: {
      voting_chain_id: '0x1',
      voting_machine_address: null,
      voting_strategy_address: payload.strategy,
      creation_block: archiveRow.block_number,
    },
    choices: AAVE_V2_CHOICES,
  };
}

function projectStateTransition(
  sourceId: string,
  targetState: Extract<ProposalState, 'queued' | 'executed' | 'canceled'>,
  archiveRow: V2ProjectionArchiveRow,
  confirmedAt: Date,
): V2ProposalStateTransitionProjection {
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

function requireConfirmedAt(archiveRow: V2ProjectionArchiveRow): Date {
  if (archiveRow.confirmed_at === null) {
    throw new V2ProposalProjectionError('missing_confirmed_at', archiveRow.id);
  }

  return archiveRow.confirmed_at;
}
