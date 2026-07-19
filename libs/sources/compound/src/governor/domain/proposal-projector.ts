import { createHash } from 'node:crypto';
import type { NewProposal, NewProposalChoice, ProposalActionInput, ProposalState } from '@libs/db';
import { normalizeEscapedNewlines } from '@libs/utils';
import { extractCompoundTitle } from './title-extractor';
import type { CompoundGovernorEvent, ProposalCreatedPayload } from './types';

export interface CompoundProjectionArchiveRow {
  id: string;
  dao_source_id: string;
  source_type: string;
  chain_id: string;
  block_number: string;
  confirmed_at: Date | null;
}

export type ProposalWithoutResolvedRefs = Omit<NewProposal, 'dao_id' | 'proposer_actor_id'>;

export interface ProposalCreatedProjection {
  kind: 'proposal_created';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  proposerAddress: string;
  proposal: ProposalWithoutResolvedRefs;
  actions: ProposalActionInput[];
  choices: NewProposalChoice[];
}

export interface ProposalStateTransitionProjection {
  kind: 'proposal_state_transition';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  targetState: Extract<ProposalState, 'queued' | 'executed' | 'canceled'>;
  stateUpdatedAt: Date;
  queuedAtBlock?: string;
}

export type CompoundProposalProjection =
  | ProposalCreatedProjection
  | ProposalStateTransitionProjection;

export class ProposalProjectionError extends Error {
  constructor(
    public readonly reason: 'missing_confirmed_at' | 'created_payload_array_length_mismatch',
    public readonly archiveRowId: string,
  ) {
    super(`proposal projection failed: ${reason}`);
    this.name = 'ProposalProjectionError';
  }
}

const COMPOUND_CHOICES: ReadonlyArray<Pick<NewProposalChoice, 'choice_index' | 'value'>> = [
  { choice_index: 0, value: 'against' },
  { choice_index: 1, value: 'for' },
  { choice_index: 2, value: 'abstain' },
];

export function projectCompoundProposalEvent(
  event: CompoundGovernorEvent,
  archiveRow: CompoundProjectionArchiveRow,
): CompoundProposalProjection {
  const confirmedAt = requireConfirmedAt(archiveRow);

  switch (event.type) {
    case 'ProposalCreated':
      return projectProposalCreated(event.payload, archiveRow, confirmedAt);
    case 'ProposalQueued':
      return projectStateTransition(
        event.payload.proposalId,
        'queued',
        archiveRow,
        confirmedAt,
        archiveRow.block_number,
      );
    case 'ProposalExecuted':
      return projectStateTransition(event.payload.proposalId, 'executed', archiveRow, confirmedAt);
    case 'ProposalCanceled':
      return projectStateTransition(event.payload.proposalId, 'canceled', archiveRow, confirmedAt);
    case 'VoteCast':
      throw new Error('projectCompoundProposalEvent: VoteCast is not a proposal lifecycle event');
  }
}

function projectProposalCreated(
  payload: ProposalCreatedPayload,
  archiveRow: CompoundProjectionArchiveRow,
  confirmedAt: Date,
): ProposalCreatedProjection {
  assertAlignedActionArrays(payload, archiveRow.id);

  // Some proposers submit the description JSON-encoded, so its newlines arrive as literal "\n".
  // Repair it before anything reads it: otherwise the markdown renders as one blob and the title
  // extractor, which splits on newlines, takes the whole description as the title. The hash covers
  // the text we actually store.
  const description = normalizeEscapedNewlines(payload.description);

  return {
    kind: 'proposal_created',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    proposerAddress: payload.proposer.toLowerCase(),
    proposal: {
      source_type: archiveRow.source_type,
      source_id: payload.proposalId,
      title: extractCompoundTitle(description),
      description,
      description_hash: createHash('sha256').update(description).digest('hex'),
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
    choices: COMPOUND_CHOICES.map((choice) => ({
      proposal_id: '',
      choice_index: choice.choice_index,
      value: choice.value,
    })),
  };
}

function projectStateTransition(
  sourceId: string,
  targetState: Extract<ProposalState, 'queued' | 'executed' | 'canceled'>,
  archiveRow: CompoundProjectionArchiveRow,
  confirmedAt: Date,
  queuedAtBlock?: string,
): ProposalStateTransitionProjection {
  return {
    kind: 'proposal_state_transition',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    sourceId,
    targetState,
    stateUpdatedAt: confirmedAt,
    queuedAtBlock,
  };
}

function requireConfirmedAt(archiveRow: CompoundProjectionArchiveRow): Date {
  if (archiveRow.confirmed_at === null) {
    throw new ProposalProjectionError('missing_confirmed_at', archiveRow.id);
  }

  return archiveRow.confirmed_at;
}

function assertAlignedActionArrays(payload: ProposalCreatedPayload, archiveRowId: string): void {
  const expected = payload.targets.length;
  if (
    payload.values.length !== expected ||
    payload.signatures.length !== expected ||
    payload.calldatas.length !== expected
  ) {
    throw new ProposalProjectionError('created_payload_array_length_mismatch', archiveRowId);
  }
}
