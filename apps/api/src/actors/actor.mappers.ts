import type { Actor } from '@libs/db';
import type { ActorResponseDto } from './actor.dto';

export function toActorResponseDto(actor: Actor): ActorResponseDto {
  return {
    data: {
      actor_id: actor.id,
      primary_address: actor.primary_address,
      display_name: actor.display_name,
    },
  };
}
