import type { CastVotePayload } from './types';

export interface AragonVoteIncoming {
  /** Binary choice index: supports=true → 1 (Yes), supports=false → 0 (No). */
  primaryChoice: number;
  /** Reported voting power = the voter's snapshot stake (ADR-053 vote-row model). */
  votingPower: string;
}

/**
 * Maps a decoded Aragon `CastVote` payload to the supersession-agnostic "incoming"
 * shape consumed by `buildVoteRows`. Pure — supersession ordering is decided in the
 * applier against the current vote row.
 */
export function projectAragonVoteCast(payload: CastVotePayload): AragonVoteIncoming {
  return {
    primaryChoice: payload.supports ? 1 : 0,
    votingPower: payload.stake,
  };
}
