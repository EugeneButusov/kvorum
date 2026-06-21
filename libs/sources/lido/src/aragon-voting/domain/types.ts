export interface StartVotePayload {
  voteId: string;
  creator: string;
  metadata: string;
}

export interface CastVotePayload {
  voteId: string;
  voter: string;
  supports: boolean;
  stake: string;
}

// Co-fires with CastVote(supports=false) when votePhase == Objection.
// AA3 must dedupe: treat as phase marker, not a separate vote.
export interface CastObjectionPayload {
  voteId: string;
  voter: string;
  stake: string;
}

export interface ExecuteVotePayload {
  voteId: string;
}

// PCT_BASE = 10^18 on the Lido two-phase fork (not the standard 10^18 * 10^6).
export interface ChangeSupportRequiredPayload {
  supportRequiredPct: string;
}

export interface ChangeMinQuorumPayload {
  minAcceptQuorumPct: string;
}

export interface ChangeVoteTimePayload {
  voteTime: string;
}

export interface ChangeObjectionPhaseTimePayload {
  objectionPhaseTime: string;
}

export type AragonVotingEvent =
  | { type: 'StartVote'; payload: StartVotePayload }
  | { type: 'CastVote'; payload: CastVotePayload }
  | { type: 'CastObjection'; payload: CastObjectionPayload }
  | { type: 'ExecuteVote'; payload: ExecuteVotePayload }
  | { type: 'ChangeSupportRequired'; payload: ChangeSupportRequiredPayload }
  | { type: 'ChangeMinQuorum'; payload: ChangeMinQuorumPayload }
  | { type: 'ChangeVoteTime'; payload: ChangeVoteTimePayload }
  | { type: 'ChangeObjectionPhaseTime'; payload: ChangeObjectionPhaseTimePayload };

export const ARAGON_VOTING_EVENT_TYPES = [
  'StartVote',
  'CastVote',
  'CastObjection',
  'ExecuteVote',
  'ChangeSupportRequired',
  'ChangeMinQuorum',
  'ChangeVoteTime',
  'ChangeObjectionPhaseTime',
] as const satisfies readonly AragonVotingEvent['type'][];
