import { createHash } from 'node:crypto';
import type { NewProposal, NewProposalChoice, ProposalState } from '@libs/db';
import { extractAragonTitle } from './title-extractor';
import type { AragonVotingEvent, StartVotePayload } from './types';

export interface AragonProjectionArchiveRow {
  id: string;
  dao_source_id: string;
  source_type: string;
  chain_id: string;
  block_number: string;
  confirmed_at: Date | null;
}

export type ProposalWithoutResolvedRefs = Omit<NewProposal, 'dao_id' | 'proposer_actor_id'>;

export interface AragonProposalCreatedProjection {
  kind: 'proposal_created';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  creatorAddress: string;
  proposal: ProposalWithoutResolvedRefs;
  choices: NewProposalChoice[];
}

export interface AragonStateTransitionProjection {
  kind: 'state_transition';
  archiveRowId: string;
  daoSourceId: string;
  sourceType: string;
  sourceId: string;
  targetState: Extract<ProposalState, 'executed'>;
  stateUpdatedAt: Date;
  executedAt: Date;
}

export interface AragonConfigNoopProjection {
  kind: 'config_noop';
  archiveRowId: string;
}

export type AragonProposalProjection =
  | AragonProposalCreatedProjection
  | AragonStateTransitionProjection
  | AragonConfigNoopProjection;

export class AragonProposalProjectionError extends Error {
  constructor(
    public readonly reason: 'missing_confirmed_at',
    public readonly archiveRowId: string,
  ) {
    super(`aragon proposal projection failed: ${reason}`);
    this.name = 'AragonProposalProjectionError';
  }
}

// Binary Yea/Nay. CastVote.supports → primary_choice: true=1 (Yes), false=0 (No).
const ARAGON_CHOICES: ReadonlyArray<Pick<NewProposalChoice, 'choice_index' | 'value'>> = [
  { choice_index: 0, value: 'No' },
  { choice_index: 1, value: 'Yes' },
];

export function projectAragonProposalEvent(
  event: AragonVotingEvent,
  archiveRow: AragonProjectionArchiveRow,
): AragonProposalProjection {
  switch (event.type) {
    case 'StartVote':
      return projectStartVote(event.payload, archiveRow);
    case 'ExecuteVote': {
      const confirmedAt = requireConfirmedAt(archiveRow);
      return {
        kind: 'state_transition',
        archiveRowId: archiveRow.id,
        daoSourceId: archiveRow.dao_source_id,
        sourceType: archiveRow.source_type,
        sourceId: event.payload.voteId,
        targetState: 'executed',
        stateUpdatedAt: confirmedAt,
        executedAt: confirmedAt,
      };
    }
    case 'ChangeSupportRequired':
    case 'ChangeMinQuorum':
    case 'ChangeVoteTime':
    case 'ChangeObjectionPhaseTime':
      // Global config events: the event-only projection does not consume them
      // (pct/phase-times come from the getVote state reconciler). Drained as no-ops
      // so they reach derived_at and
      // satisfy the zero-underived acceptance gate.
      return { kind: 'config_noop', archiveRowId: archiveRow.id };
    case 'CastVote':
    case 'CastObjection':
      throw new Error(
        `projectAragonProposalEvent: ${event.type} is not a proposal lifecycle event`,
      );
  }
}

function projectStartVote(
  payload: StartVotePayload,
  archiveRow: AragonProjectionArchiveRow,
): AragonProposalCreatedProjection {
  const confirmedAt = requireConfirmedAt(archiveRow);
  const description = payload.metadata ?? '';

  return {
    kind: 'proposal_created',
    archiveRowId: archiveRow.id,
    daoSourceId: archiveRow.dao_source_id,
    sourceType: archiveRow.source_type,
    sourceId: payload.voteId,
    creatorAddress: payload.creator.toLowerCase(),
    proposal: {
      source_type: archiveRow.source_type,
      source_id: payload.voteId,
      title: extractAragonTitle(description, payload.voteId),
      description,
      description_hash: createHash('sha256').update(description).digest('hex'),
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: archiveRow.block_number,
      voting_ends_block: null,
      // Aragon opens voting immediately at StartVote (no pending phase). Terminal
      // non-executed states (succeeded/defeated/expired) are derived by the reconciler.
      state: 'active',
      state_updated_at: confirmedAt,
      updated_at: confirmedAt,
    },
    choices: ARAGON_CHOICES.map((choice) => ({
      proposal_id: '',
      choice_index: choice.choice_index,
      value: choice.value,
    })),
  };
}

function requireConfirmedAt(archiveRow: AragonProjectionArchiveRow): Date {
  if (archiveRow.confirmed_at === null) {
    throw new AragonProposalProjectionError('missing_confirmed_at', archiveRow.id);
  }
  return archiveRow.confirmed_at;
}
