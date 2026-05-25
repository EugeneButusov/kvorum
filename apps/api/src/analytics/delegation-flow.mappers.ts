import type { ActorPowerRow, DelegationFlowEdgeRow } from './analytics-read-repository';
import type { DelegationFlowEdgeDto, DelegationFlowNodeDto } from './delegation-flow.dto';
import { delegateActorIdFromCh } from './sentinels';

export function toDelegationFlowEdgeDto(row: DelegationFlowEdgeRow): DelegationFlowEdgeDto {
  return {
    delegator_actor_id: row.delegator_actor_id,
    delegate_actor_id: delegateActorIdFromCh(row.delegate_actor_id),
    voting_power: row.voting_power,
    block_number: row.block_number,
    event_type: row.event_type,
    created_at: row.created_at.toISOString(),
  };
}

export function toDelegationFlowNodeDtos(args: {
  powers: ActorPowerRow[];
  actorsById: Map<string, { primary_address: string; display_name: string | null }>;
}): DelegationFlowNodeDto[] {
  return args.powers.map((p) => {
    const actor = args.actorsById.get(p.actor_id);
    return {
      actor_id: p.actor_id,
      primary_address: actor?.primary_address ?? '',
      display_name: actor?.display_name ?? null,
      current_voting_power: p.voting_power,
    };
  });
}
