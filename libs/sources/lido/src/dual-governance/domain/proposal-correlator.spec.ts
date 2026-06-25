import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildDirectProposal,
  callsToProposalActions,
  computeCallsHash,
  ledgerStatusToProposalState,
} from './proposal-correlator';
import type { ExternalCall } from './types';

const CALL_A: ExternalCall = {
  target: '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa',
  value: '0',
  payload: '0xDEADBEEF',
};
const CALL_B: ExternalCall = {
  target: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  value: '1000000000000000000',
  payload: '0xCAFE',
};

describe('computeCallsHash', () => {
  it('is deterministic and case-insensitive over target/payload', () => {
    const lower = computeCallsHash([CALL_A]);
    const mixed = computeCallsHash([
      { ...CALL_A, target: CALL_A.target.toUpperCase(), payload: '0xdeadbeef' },
    ]);
    expect(lower).toBe(mixed);
    expect(lower).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is order-sensitive (execution order is semantic)', () => {
    expect(computeCallsHash([CALL_A, CALL_B])).not.toBe(computeCallsHash([CALL_B, CALL_A]));
  });

  it('distinguishes different values', () => {
    expect(computeCallsHash([CALL_A])).not.toBe(computeCallsHash([{ ...CALL_A, value: '1' }]));
  });
});

describe('callsToProposalActions', () => {
  it('maps a single call to one action (1:1 case)', () => {
    expect(callsToProposalActions([CALL_A], '0x1')).toEqual([
      {
        targetAddress: CALL_A.target.toLowerCase(),
        targetChainId: '0x1',
        valueWei: '0',
        functionSignature: null,
        calldata: '0xDEADBEEF',
      },
    ]);
  });

  it('maps an omnibus submission to one action per inner call, in order', () => {
    const actions = callsToProposalActions([CALL_A, CALL_B], '0x1');
    expect(actions).toHaveLength(2);
    expect(actions[0]?.targetAddress).toBe(CALL_A.target.toLowerCase());
    expect(actions[1]?.targetAddress).toBe(CALL_B.target.toLowerCase());
    expect(actions[1]?.valueWei).toBe('1000000000000000000');
  });

  it('returns [] for no calls', () => {
    expect(callsToProposalActions([], '0x1')).toEqual([]);
  });
});

describe('ledgerStatusToProposalState', () => {
  it('maps submitted and scheduled to queued', () => {
    expect(ledgerStatusToProposalState('submitted')).toBe('queued');
    expect(ledgerStatusToProposalState('scheduled')).toBe('queued');
  });

  it('maps executed to executed and cancelled to canceled', () => {
    expect(ledgerStatusToProposalState('executed')).toBe('executed');
    expect(ledgerStatusToProposalState('cancelled')).toBe('canceled');
  });
});

describe('buildDirectProposal', () => {
  const base = {
    dgProposalId: '7',
    submittedBlock: '23095715',
    submittedAt: new Date('2026-01-02T00:00:00Z'),
  };

  it('builds a binding dual_governance proposal with title from the first metadata line', () => {
    const draft = buildDirectProposal({ ...base, metadata: '# Upgrade the oracle\n\nbody text' });
    expect(draft).toEqual({
      source_type: 'dual_governance',
      source_id: '7',
      title: 'Upgrade the oracle',
      description: '# Upgrade the oracle\n\nbody text',
      description_hash: createHash('sha256')
        .update('# Upgrade the oracle\n\nbody text')
        .digest('hex'),
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '23095715',
      voting_ends_block: null,
      state: 'queued',
      state_updated_at: base.submittedAt,
      updated_at: base.submittedAt,
    });
  });

  it('falls back to a stable placeholder title for empty metadata', () => {
    const draft = buildDirectProposal({ ...base, metadata: '' });
    expect(draft.title).toBe('Dual Governance proposal #7');
  });

  it('truncates an overly long title', () => {
    const draft = buildDirectProposal({ ...base, metadata: 'x'.repeat(500) });
    expect(draft.title).toHaveLength(200);
  });
});
