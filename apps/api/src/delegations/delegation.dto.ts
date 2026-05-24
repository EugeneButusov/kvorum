import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../openapi/openapi.dto';

export class DelegationActorLinksDto {
  @ApiProperty()
  declare actor: string;
}

export class DelegationActorMetaDto {
  @ApiProperty({ type: DelegationActorLinksDto })
  declare links: DelegationActorLinksDto;
}

export class DelegationActorDto {
  @ApiProperty()
  declare address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;

  @ApiProperty({ type: DelegationActorMetaDto })
  declare _meta: DelegationActorMetaDto;
}

export class DelegationListItemDto {
  @ApiProperty()
  declare delegation_id: string;

  @ApiProperty({ type: DelegationActorDto })
  declare delegator: DelegationActorDto;

  @ApiProperty({ nullable: true, type: DelegationActorDto })
  declare delegate: DelegationActorDto | null;

  @ApiProperty({ type: String })
  declare voting_power: string;

  @ApiProperty({ type: String })
  declare block_number: string;

  @ApiProperty()
  declare event_type: 'delegate_changed' | 'votes_changed';

  @ApiProperty()
  declare tx_hash: string;

  @ApiProperty({ nullable: true })
  declare created_at: string | null;
}

export class DelegationListResponseDto {
  @ApiProperty({ type: () => [DelegationListItemDto] })
  declare data: DelegationListItemDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;
}

export class CurrentDelegatorsMetaDto {
  @ApiProperty({ type: String })
  declare as_of_block_number: string;
}

export class CurrentDelegatorsResponseDto {
  @ApiProperty({ type: () => [DelegationListItemDto] })
  declare data: DelegationListItemDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;

  @ApiProperty({ type: CurrentDelegatorsMetaDto })
  declare _meta: CurrentDelegatorsMetaDto;
}

export class ActorDelegationResponseDto {
  @ApiProperty({ nullable: true, type: DelegationListItemDto })
  declare data: DelegationListItemDto | null;
}
