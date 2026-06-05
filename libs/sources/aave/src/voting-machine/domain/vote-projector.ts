import type { VoteEmittedPayload } from './types';

export function projectAaveVote(payload: VoteEmittedPayload): {
  primaryChoice: number;
  votingPower: string;
} {
  return {
    primaryChoice: payload.support ? 1 : 0,
    votingPower: payload.votingPower,
  };
}
