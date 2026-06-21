import type { VoteEmittedPayload } from './types';

export function projectAaveVote(payload: VoteEmittedPayload): {
  primaryChoice: number;
  votingPower: string;
} {
  const primaryChoice = payload.support ? 1 : 0;
  return {
    primaryChoice,
    votingPower: payload.votingPower,
  };
}
