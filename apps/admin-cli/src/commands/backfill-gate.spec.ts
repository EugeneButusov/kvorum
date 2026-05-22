import { describe, expect, it } from 'vitest';
import { validateFromBlockGate } from './backfill-gate.js';

describe('validateFromBlockGate', () => {
  it('rejects from-block below active_from_block', () => {
    const result = validateFromBlockGate({
      fromBlock: 11_999_999n,
      activeFromBlock: '12000000',
      backfillHeadBlock: '12500000',
      confirmReplay: false,
    });

    expect(result?.code).toBe('below_active_floor');
    expect(result?.message).toContain('active_from_block (12000000)');
  });

  it('requires confirm-replay below backfill head', () => {
    const result = validateFromBlockGate({
      fromBlock: 12_100_000n,
      activeFromBlock: '12000000',
      backfillHeadBlock: '12500000',
      confirmReplay: false,
    });

    expect(result?.code).toBe('replay_requires_confirmation');
    expect(result?.message).toContain('Pass --confirm-replay');
    expect(result?.message).toContain('400001');
  });

  it('allows replay when confirm-replay is set', () => {
    const result = validateFromBlockGate({
      fromBlock: 12_100_000n,
      activeFromBlock: '12000000',
      backfillHeadBlock: '12500000',
      confirmReplay: true,
    });

    expect(result).toBeNull();
  });

  it('allows boundary at active_from_block when no backfill_head_block exists', () => {
    const result = validateFromBlockGate({
      fromBlock: 12_000_000n,
      activeFromBlock: '12000000',
      backfillHeadBlock: null,
      confirmReplay: false,
    });

    expect(result).toBeNull();
  });

  it('requires confirm-replay at backfill_head_block boundary', () => {
    const result = validateFromBlockGate({
      fromBlock: 12_500_000n,
      activeFromBlock: '12000000',
      backfillHeadBlock: '12500000',
      confirmReplay: false,
    });

    expect(result?.code).toBe('replay_requires_confirmation');
  });

  it('allows first block above backfill head without confirm-replay', () => {
    const result = validateFromBlockGate({
      fromBlock: 12_500_001n,
      activeFromBlock: '12000000',
      backfillHeadBlock: '12500000',
      confirmReplay: false,
    });

    expect(result).toBeNull();
  });
});
