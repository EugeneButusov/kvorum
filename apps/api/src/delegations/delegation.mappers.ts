import type { DelegationReadRow } from '@libs/db';
import type { DelegationModel, OffchainDelegationView } from '@libs/domain';
import { OffchainDelegationDto } from '@nest/sources';
import { DelegationListItemDto } from './delegation.dto';
import { isoSeconds } from '../http/iso';

function toEmbeddedActor(address: string, displayName: string | null) {
  const normalized = address.toLowerCase();
  return {
    address: normalized,
    display_name: displayName,
    _meta: {
      links: {
        actor: `/v1/actors/${normalized}`,
      },
    },
  };
}

export function toDelegationListItemDto(
  row: DelegationReadRow,
  model: DelegationModel,
): DelegationListItemDto {
  return Object.assign(new DelegationListItemDto(), {
    delegation_id: row.id,
    delegator: toEmbeddedActor(row.delegator_address, row.delegator_display_name),
    delegate:
      row.delegate_address === null
        ? null
        : toEmbeddedActor(row.delegate_address, row.delegate_display_name),
    voting_power: row.voting_power,
    block_number: row.block_number,
    event_type: row.event_type,
    model,
    tx_hash: row.tx_hash,
    created_at: isoSeconds(row.created_at),
  });
}

export function toOffchainDelegationDto(view: OffchainDelegationView): OffchainDelegationDto {
  return Object.assign(new OffchainDelegationDto(), {
    platform: view.platform,
    system: view.system,
    scope: view.scope,
    network: view.network,
    delegate_address: view.delegate_address.toLowerCase(),
    weight: view.weight,
    expires_at: view.expires_at,
  });
}
