import { Interface } from 'ethers';

/**
 * `getVote(uint256)` on the deployed Lido Voting fork.
 *
 * For confirmed-head reads the deployed implementation is the current one, which
 * serves every vote (old and new) through the post-objection-phase 11-field ABI —
 * so a single fragment suffices (no era-by-voteId branch). The 10-field pre-fork
 * shape is only relevant to historical archive-node reads, which the reconciler
 * does not do. `phase` is a 3-value enum: Main=0, Objection=1, Closed=2;
 * `open == (phase != Closed)`. Classification keys off `open`, not `phase`.
 */
export const GET_VOTE_INTERFACE = new Interface([
  'function getVote(uint256 _voteId) view returns (bool open, bool executed, uint64 startDate, uint64 snapshotBlock, uint64 supportRequired, uint64 minAcceptQuorum, uint256 yea, uint256 nay, uint256 votingPower, bytes script, uint8 phase)',
]);

export interface AragonGetVoteResult {
  open: boolean;
  executed: boolean;
  /** unix seconds */
  startDate: number;
  snapshotBlock: bigint;
  /** PCT_BASE(10^18)-scaled support threshold, frozen at creation */
  supportRequired: bigint;
  /** PCT_BASE(10^18)-scaled min-accept quorum, frozen at creation */
  minAcceptQuorum: bigint;
  yea: bigint;
  nay: bigint;
  votingPower: bigint;
  /** raw EVMScript hex (0x-prefixed) */
  script: string;
  /** 0=Main, 1=Objection, 2=Closed */
  phase: number;
}

export class AragonGetVoteDecodeError extends Error {
  constructor(
    message: string,
    public readonly causeValue: unknown,
  ) {
    super(message);
    this.name = 'AragonGetVoteDecodeError';
  }
}

export function encodeGetVote(voteId: string): string {
  return GET_VOTE_INTERFACE.encodeFunctionData('getVote', [BigInt(voteId)]);
}

export function decodeGetVote(data: string): AragonGetVoteResult {
  try {
    const r = GET_VOTE_INTERFACE.decodeFunctionResult('getVote', data);
    return {
      open: Boolean(r[0]),
      executed: Boolean(r[1]),
      startDate: Number(r[2]),
      snapshotBlock: BigInt(r[3]),
      supportRequired: BigInt(r[4]),
      minAcceptQuorum: BigInt(r[5]),
      yea: BigInt(r[6]),
      nay: BigInt(r[7]),
      votingPower: BigInt(r[8]),
      script: r[9] as string,
      phase: Number(r[10]),
    };
  } catch (err) {
    throw new AragonGetVoteDecodeError('failed to decode getVote() result', err);
  }
}
