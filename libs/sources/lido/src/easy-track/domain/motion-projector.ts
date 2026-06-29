import { createHash } from 'node:crypto';
import type { NewProposal, ProposalState } from '@libs/db';
import { easyTrackMotionTitle } from './title-extractor';
import type { MotionCreatedPayload } from './types';
import type { EasyTrackMotionState, NewEasyTrackMotionMeta } from '../../persistence/schema';

// dao_id + proposer_actor_id are resolved by the applier after dao/actor lookup; proposal_id is the
// PK the applier fills after the proposal insert returns.
export type ProposalDraft = Omit<NewProposal, 'dao_id' | 'proposer_actor_id'>;
export type MotionMetaDraft = Omit<NewEasyTrackMotionMeta, 'proposal_id'>;

export interface MotionCreatedProjection {
  creatorAddress: string;
  proposal: ProposalDraft;
  meta: MotionMetaDraft;
}

export interface MotionCreatedContext {
  sourceType: string;
  blockNumber: string;
  // On-chain `MotionCreated` block time — the objection window start.
  blockTimestamp: Date;
  // blockTimestamp + the motion duration in force at creation; the optimistic-enact deadline.
  objectionEndsAt: Date;
  // Ingestion/derivation clock (archive `received_at`); the audit timestamp for `state_updated_at`.
  confirmedAt: Date;
}

/**
 * `MotionCreated` → a unified `proposal` (state `active`, the objection window open) + an
 * `easy_track_motion_meta` row. Binding (motions execute on-chain via the EVMScriptExecutor → Agent).
 * Title is the deterministic placeholder; description is empty until the EVMScript is decoded.
 */
export function projectMotionCreated(
  payload: MotionCreatedPayload,
  ctx: MotionCreatedContext,
): MotionCreatedProjection {
  const description = '';
  return {
    creatorAddress: payload.creator.toLowerCase(),
    proposal: {
      source_type: ctx.sourceType,
      source_id: payload.motionId,
      title: easyTrackMotionTitle(payload.motionId),
      description,
      description_hash: createHash('sha256').update(description).digest('hex'),
      binding: true,
      voting_starts_at: ctx.blockTimestamp,
      voting_ends_at: ctx.objectionEndsAt,
      voting_starts_block: ctx.blockNumber,
      voting_ends_block: null,
      state: 'active',
      state_updated_at: ctx.confirmedAt,
      updated_at: ctx.confirmedAt,
    },
    meta: {
      motion_id: payload.motionId,
      factory_address: payload.evmScriptFactory.toLowerCase(),
      objection_ends_at: ctx.objectionEndsAt,
      state: 'active',
      last_reconcile_check_block: null,
    },
  };
}

// Terminal motion events → (unified `proposal` target state, motion-meta state). `advanceState` is
// guarded + terminal-locked, so applying these out of order or twice is safe.
export type MotionTerminalEvent = 'MotionEnacted' | 'MotionRejected' | 'MotionCanceled';

export const MOTION_TERMINAL_TRANSITIONS: Record<
  MotionTerminalEvent,
  {
    proposalState: Extract<ProposalState, 'executed' | 'defeated' | 'canceled'>;
    motionState: EasyTrackMotionState;
  }
> = {
  MotionEnacted: { proposalState: 'executed', motionState: 'enacted' },
  MotionRejected: { proposalState: 'defeated', motionState: 'rejected' },
  MotionCanceled: { proposalState: 'canceled', motionState: 'canceled' },
};
