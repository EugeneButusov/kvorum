import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MOTION_TERMINAL_TRANSITIONS,
  projectMotionCreated,
  type MotionCreatedContext,
} from './motion-projector';
import type { MotionCreatedPayload } from './types';

const PAYLOAD: MotionCreatedPayload = {
  motionId: '42',
  creator: '0xAbCAbCAbCaBCaBcAbcAbCABcabcAbCAbcABcAbCaB',
  evmScriptFactory: '0x2222222222222222222222222222222222222222',
  evmScriptCallData: '0xc0ffee',
  evmScript: '0xdeadbeef',
};

const CTX: MotionCreatedContext = {
  sourceType: 'easy_track',
  blockNumber: '13700000',
  blockTimestamp: new Date('2026-01-01T00:00:00Z'),
  objectionEndsAt: new Date('2026-01-04T00:00:00Z'),
  confirmedAt: new Date('2026-01-01T00:05:00Z'),
};

describe('projectMotionCreated', () => {
  it('maps a motion to an active, binding proposal with the objection window as the voting window', () => {
    const out = projectMotionCreated(PAYLOAD, CTX);
    expect(out.creatorAddress).toBe(PAYLOAD.creator.toLowerCase());
    expect(out.proposal).toEqual({
      source_type: 'easy_track',
      source_id: '42',
      title: 'Easy Track motion #42',
      description: '',
      description_hash: createHash('sha256').update('').digest('hex'),
      binding: true,
      voting_starts_at: CTX.blockTimestamp,
      voting_ends_at: CTX.objectionEndsAt,
      voting_starts_block: '13700000',
      voting_ends_block: null,
      state: 'active',
      state_updated_at: CTX.confirmedAt,
      updated_at: CTX.confirmedAt,
    });
  });

  it('builds the motion-meta draft with the lowercased factory + objection deadline', () => {
    const out = projectMotionCreated(PAYLOAD, CTX);
    expect(out.meta).toEqual({
      motion_id: '42',
      factory_address: PAYLOAD.evmScriptFactory.toLowerCase(),
      objection_ends_at: CTX.objectionEndsAt,
      state: 'active',
      last_reconcile_check_block: null,
    });
  });

  it('maps each terminal event to the right proposal + motion state', () => {
    expect(MOTION_TERMINAL_TRANSITIONS).toEqual({
      MotionEnacted: { proposalState: 'executed', motionState: 'enacted' },
      MotionRejected: { proposalState: 'defeated', motionState: 'rejected' },
      MotionCanceled: { proposalState: 'canceled', motionState: 'canceled' },
    });
  });
});
