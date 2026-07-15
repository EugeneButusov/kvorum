import type { DelegateLeaderboardRow } from '@libs/db';
import type { DelegateLeaderboardRowDto } from './delegate-leaderboard.dto';

/** Share of the DAO-wide delegated total, as a 0..1 fraction with 4-decimal precision. */
export function shareOf(votingPower: string, totalVotingPower: string): number {
  const total = BigInt(totalVotingPower);
  if (total <= 0n) return 0;
  return Number((BigInt(votingPower) * 10000n) / total) / 10000;
}

export function toDelegateLeaderboardRowDto(
  row: DelegateLeaderboardRow,
  rank: number,
  totalVotingPower: string,
  actor: { primary_address: string; display_name: string | null } | undefined,
): DelegateLeaderboardRowDto {
  return {
    rank,
    actor_id: row.actor_id,
    address: actor?.primary_address ?? '',
    display_name: actor?.display_name ?? null,
    voting_power: row.voting_power,
    voting_power_share: shareOf(row.voting_power, totalVotingPower),
    delegator_count: row.delegator_count,
  };
}
