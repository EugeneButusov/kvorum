import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  applyUnifiedProposalState,
  buildDirectProposal,
  callsToProposalActions,
  computeCallsHash,
  ledgerStatusToProposalState,
  resolveUnifiedProposalState,
  type UnifiedProposalLedgerRow,
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

describe('resolveUnifiedProposalState (ADR-031 vetoed precedence)', () => {
  const baseLedger: UnifiedProposalLedgerRow = {
    status: 'scheduled',
    submitted_at: new Date('2026-01-01T00:00:00Z'),
    cancelled_at: null,
  };
  const insideWindow = [new Date('2026-02-01T00:00:00Z')]; // after submitted_at
  const beforeSubmission = [new Date('2025-12-01T00:00:00Z')]; // before submitted_at

  it('returns f(ledger status) when there are no rage-quits', () => {
    expect(resolveUnifiedProposalState(baseLedger, [])).toBe('queued');
  });

  it('returns vetoed for a non-executed proposal covered by a rage-quit', () => {
    expect(resolveUnifiedProposalState(baseLedger, insideWindow)).toBe('vetoed');
  });

  it('does not veto when every rage-quit predates the proposal submission', () => {
    expect(resolveUnifiedProposalState(baseLedger, beforeSubmission)).toBe('queued');
  });

  it('vetoed outranks canceled (a bulk-cancel inside a rage-quit window)', () => {
    const cancelled: UnifiedProposalLedgerRow = {
      ...baseLedger,
      status: 'cancelled',
      cancelled_at: new Date('2026-03-01T00:00:00Z'),
    };
    // rage-quit 2026-02-01 ∈ [submitted 2026-01-01, cancelled 2026-03-01]
    expect(resolveUnifiedProposalState(cancelled, insideWindow)).toBe('vetoed');
  });

  it('does not veto when the rage-quit lands after the proposal was cancelled', () => {
    const cancelled: UnifiedProposalLedgerRow = {
      ...baseLedger,
      status: 'cancelled',
      cancelled_at: new Date('2026-01-15T00:00:00Z'),
    };
    // rage-quit 2026-02-01 is AFTER cancelled_at 2026-01-15 → out of window
    expect(resolveUnifiedProposalState(cancelled, insideWindow)).toBe('canceled');
  });

  it('treats the window bounds as inclusive', () => {
    expect(resolveUnifiedProposalState(baseLedger, [baseLedger.submitted_at])).toBe('vetoed');
    const cancelled: UnifiedProposalLedgerRow = {
      ...baseLedger,
      status: 'cancelled',
      cancelled_at: new Date('2026-02-01T00:00:00Z'),
    };
    expect(resolveUnifiedProposalState(cancelled, [cancelled.cancelled_at!])).toBe('vetoed');
  });

  it('an executed proposal stays executed even if a rage-quit overlapped (veto did not stop it)', () => {
    const executed: UnifiedProposalLedgerRow = { ...baseLedger, status: 'executed' };
    expect(resolveUnifiedProposalState(executed, insideWindow)).toBe('executed');
  });
});

describe('applyUnifiedProposalState', () => {
  const ledger = {
    proposal_id: 'prop-1',
    status: 'scheduled' as const,
    submitted_at: new Date('2026-01-01T00:00:00Z'),
    cancelled_at: null,
  };

  it('resolves and writes the unified state via setStateFromDerivation', async () => {
    const proposals = { setStateFromDerivation: vi.fn().mockResolvedValue(undefined) };
    const at = new Date('2026-03-01T00:00:00Z');
    const state = await applyUnifiedProposalState(
      proposals,
      ledger,
      [new Date('2026-02-01T00:00:00Z')],
      at,
    );
    expect(state).toBe('vetoed');
    expect(proposals.setStateFromDerivation).toHaveBeenCalledWith({
      proposalId: 'prop-1',
      state: 'vetoed',
      stateUpdatedAt: at,
    });
  });
});
