import { describe, expect, it } from 'vitest';
import {
  GET_VOTE_INTERFACE,
  AragonGetVoteDecodeError,
  decodeGetVote,
  encodeGetVote,
} from './get-vote';

function encodeResult(fields: {
  open: boolean;
  executed: boolean;
  startDate: bigint;
  snapshotBlock: bigint;
  supportRequired: bigint;
  minAcceptQuorum: bigint;
  yea: bigint;
  nay: bigint;
  votingPower: bigint;
  script: string;
  phase: number;
}): string {
  return GET_VOTE_INTERFACE.encodeFunctionResult('getVote', [
    fields.open,
    fields.executed,
    fields.startDate,
    fields.snapshotBlock,
    fields.supportRequired,
    fields.minAcceptQuorum,
    fields.yea,
    fields.nay,
    fields.votingPower,
    fields.script,
    fields.phase,
  ]);
}

describe('getVote ABI', () => {
  it('encodeGetVote produces the getVote(uint256) selector + arg', () => {
    const data = encodeGetVote('170');
    expect(data).toBe(GET_VOTE_INTERFACE.encodeFunctionData('getVote', [170n]));
  });

  it('decodes a closed, passing vote (phase=Closed=2)', () => {
    const data = encodeResult({
      open: false,
      executed: false,
      startDate: 1_700_000_000n,
      snapshotBlock: 18_000_000n,
      supportRequired: 500_000_000_000_000_000n, // 50% @ 1e18
      minAcceptQuorum: 50_000_000_000_000_000n, // 5%
      yea: 700n,
      nay: 100n,
      votingPower: 1_000n,
      script: '0x00000001',
      phase: 2,
    });
    const v = decodeGetVote(data);
    expect(v.open).toBe(false);
    expect(v.executed).toBe(false);
    expect(v.startDate).toBe(1_700_000_000);
    expect(v.supportRequired).toBe(500_000_000_000_000_000n);
    expect(v.yea).toBe(700n);
    expect(v.votingPower).toBe(1_000n);
    expect(v.script).toBe('0x00000001');
    expect(v.phase).toBe(2);
  });

  it('decodes an open vote in the objection phase (phase=1)', () => {
    const data = encodeResult({
      open: true,
      executed: false,
      startDate: 1_700_000_000n,
      snapshotBlock: 18_000_000n,
      supportRequired: 500_000_000_000_000_000n,
      minAcceptQuorum: 50_000_000_000_000_000n,
      yea: 10n,
      nay: 0n,
      votingPower: 1_000n,
      script: '0x',
      phase: 1,
    });
    const v = decodeGetVote(data);
    expect(v.open).toBe(true);
    expect(v.phase).toBe(1);
  });

  it('throws AragonGetVoteDecodeError on malformed data', () => {
    expect(() => decodeGetVote('0x1234')).toThrow(AragonGetVoteDecodeError);
  });
});
