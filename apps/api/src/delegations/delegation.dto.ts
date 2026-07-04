import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DelegationModel } from '@libs/domain';
import { OffchainDelegationDto } from '@nest/sources';
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

  // Source-wide delegation semantics (ADR-0069). 'relationship-only' sources (e.g. Aave)
  // carry voting_power='0' by design; 'power-bearing' sources (e.g. Compound) report power.
  @ApiProperty({ enum: ['relationship-only', 'power-bearing'] })
  declare model: DelegationModel;

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

// An actor's current delegation within a DAO: the EVM delegation (delegation_flow, single) plus any
// off-chain delegations (Snapshot: space-scoped, one-to-many). Off-chain is a separate field because
// it doesn't fit the EVM-shaped, cross-store-paginated /delegations list (ADR-0074).
export class ActorDelegationDto {
  @ApiPropertyOptional({ nullable: true, type: DelegationListItemDto })
  declare evm: DelegationListItemDto | null;

  @ApiProperty({ type: () => [OffchainDelegationDto] })
  declare offchain: OffchainDelegationDto[];
}

export class ActorDelegationResponseDto {
  @ApiProperty({ type: ActorDelegationDto })
  declare data: ActorDelegationDto;
}
