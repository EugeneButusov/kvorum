import type { Actor } from '@libs/db';
import type { ActorResponseDto } from './actor.dto';

type ActorAddressRow = { address: string; is_primary: boolean; source: string };

export function toActorResponseDto(actor: Actor, addresses: ActorAddressRow[]): ActorResponseDto {
  return {
    data: {
      actor_id: actor.id,
      primary_address: actor.primary_address,
      display_name: actor.display_name,
      all_addresses: addresses.map((address) => ({
        address: address.address.toLowerCase(),
        is_primary: address.is_primary,
        source: address.source,
      })),
    },
  };
}
