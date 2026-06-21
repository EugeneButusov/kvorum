import { singleChoiceBreakdown } from '@sources/core';
import type { VoteEmittedPayload } from './types';

export function projectAaveVote(payload: VoteEmittedPayload): {
  primaryChoice: number;
  votingPower: string;
  choices: string;
  seq: string;
} {
  const primaryChoice = payload.support ? 1 : 0;
  return {
    primaryChoice,
    votingPower: payload.votingPower,
    choices: singleChoiceBreakdown(primaryChoice),
    seq: '0',
  };
}
