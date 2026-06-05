import type { ArchiveDerivationRow, CurrentVoteRow } from '@libs/db';
import type { NewVoteEventsProjectionRow } from '../persistence/schema';

export type VoteProjectionHoldReason = 'no_proposal' | 'single_voting_chain_violation';
export type VoteProjectionDlqReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'watermark_update_error'
  | 'block_timestamp_unavailable';
export type VoteProjectionErrorReason = VoteProjectionHoldReason | VoteProjectionDlqReason;

export class ProjectionError extends Error {
  constructor(public readonly reason: VoteProjectionErrorReason) {
    super(reason);
    this.name = 'ProjectionError';
  }
}

export function isNewerVote(
  castAt: Date,
  blockNumber: string,
  logIndex: number,
  current: CurrentVoteRow | undefined,
): boolean {
  if (current === undefined) return true;
  if (castAt.getTime() !== current.castAt.getTime()) return castAt > current.castAt;

  const incomingBlock = BigInt(blockNumber);
  const currentBlock = BigInt(current.blockNumber);
  if (incomingBlock !== currentBlock) return incomingBlock > currentBlock;

  return logIndex > current.logIndex;
}

export function buildVoteRows(args: {
  row: ArchiveDerivationRow;
  daoId: string;
  proposalId: string;
  voterAddress: string;
  castAt: Date;
  incoming: { primaryChoice: number; votingPower: string };
  current: CurrentVoteRow | undefined;
  incomingIsNewer: boolean;
}): readonly NewVoteEventsProjectionRow[] {
  const incomingVoteId = args.row.id;
  const incoming: NewVoteEventsProjectionRow = {
    vote_id: incomingVoteId,
    dao_id: args.daoId,
    proposal_id: args.proposalId,
    voter_address: args.voterAddress,
    voting_chain_id: args.row.chain_id,
    primary_choice: args.incoming.primaryChoice,
    voting_power: args.incoming.votingPower,
    cast_at: args.castAt,
    block_number: args.row.block_number,
    log_index: args.row.log_index,
    superseded: args.incomingIsNewer ? 0 : 1,
    superseded_at: args.incomingIsNewer ? null : args.castAt,
    superseded_by_vote_id: args.incomingIsNewer ? null : (args.current?.voteId ?? null),
  };
  if (!args.incomingIsNewer || args.current === undefined) return [incoming];

  return [
    incoming,
    {
      vote_id: args.current.voteId,
      dao_id: args.daoId,
      proposal_id: args.proposalId,
      voter_address: args.voterAddress,
      voting_chain_id: args.current.votingChainId,
      primary_choice: args.current.primaryChoice,
      voting_power: args.current.votingPower,
      cast_at: args.current.castAt,
      block_number: args.current.blockNumber,
      log_index: args.current.logIndex,
      superseded: 1,
      superseded_at: args.castAt,
      superseded_by_vote_id: incomingVoteId,
    },
  ];
}
