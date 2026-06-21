import type { ArchiveDerivationRow, CurrentVoteRow } from '@libs/db';
import type { NewVoteEventsProjectionRow } from '../persistence/schema';

export function isNewerVote(
  castAt: Date,
  blockNumber: string,
  logIndex: number,
  seq: string,
  current: CurrentVoteRow | undefined,
): boolean {
  if (current === undefined) return true;
  if (castAt.getTime() !== current.cast_at.getTime()) return castAt > current.cast_at;

  const incomingBlock = BigInt(blockNumber);
  const currentBlock = BigInt(current.block_number);
  if (incomingBlock !== currentBlock) return incomingBlock > currentBlock;

  if (logIndex !== current.log_index) return logIndex > current.log_index;

  return BigInt(seq) > BigInt(current.seq);
}

export function buildVoteRows(args: {
  row: ArchiveDerivationRow;
  daoId: string;
  proposalId: string;
  voterAddress: string;
  castAt: Date;
  incoming: { primaryChoice: number; votingPower: string; seq: string };
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
    seq: args.incoming.seq,
    voting_power: args.incoming.votingPower,
    cast_at: args.castAt,
    block_number: args.row.block_number,
    log_index: args.row.log_index,
    superseded: args.incomingIsNewer ? 0 : 1,
    superseded_at: args.incomingIsNewer ? null : args.castAt,
    superseded_by_vote_id: args.incomingIsNewer ? null : (args.current?.vote_id ?? null),
  };
  if (!args.incomingIsNewer || args.current === undefined) return [incoming];

  return [
    incoming,
    {
      vote_id: args.current.vote_id,
      dao_id: args.daoId,
      proposal_id: args.proposalId,
      voter_address: args.voterAddress,
      voting_chain_id: args.current.voting_chain_id,
      primary_choice: args.current.primary_choice,
      seq: args.current.seq,
      voting_power: args.current.voting_power,
      cast_at: args.current.cast_at,
      block_number: args.current.block_number,
      log_index: args.current.log_index,
      superseded: 1,
      superseded_at: args.castAt,
      superseded_by_vote_id: incomingVoteId,
    },
  ];
}
