import type { ActorPowerRow, DelegationFlowEdgeRow } from '@libs/db';
import type { DelegationFlowEdgeDto, DelegationFlowNodeDto } from './delegation-flow.dto';
import { delegateActorIdFromCh } from './sentinels';
import { toIsoDate } from '../http/iso';

/**
 * Edges whose delegator resolves to no actor are not renderable — the node list is built from
 * resolved actors, so such an edge would dangle — and `delegator_actor_id` is non-null in the
 * contract. Callers drop them via {@link hasResolvedDelegator} rather than emitting a null through a
 * field typed as a string. No production row is in that state: every one of the 21,449 distinct
 * delegator addresses resolves.
 *
 * The delegate end is different and deliberately kept: delegating to address(0) is how a holder
 * *un*delegates, and those edges are meaningful, so the DTO has always allowed null there.
 */
export function hasResolvedDelegator(
  row: DelegationFlowEdgeRow,
): row is DelegationFlowEdgeRow & { delegator_actor_id: string } {
  return row.delegator_actor_id !== null;
}

export function toDelegationFlowEdgeDto(
  row: DelegationFlowEdgeRow & { delegator_actor_id: string },
): DelegationFlowEdgeDto {
  return {
    delegator_actor_id: row.delegator_actor_id,
    delegate_actor_id: delegateActorIdFromCh(row.delegate_actor_id),
    voting_power: row.voting_power,
    block_number: row.block_number,
    event_type: row.event_type,
    created_at: toIsoDate(row.created_at),
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
