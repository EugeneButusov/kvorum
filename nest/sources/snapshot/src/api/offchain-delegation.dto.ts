import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// An actor's current off-chain delegation (today Snapshot: Delegate Registry single or Split
// Delegation weighted). Medium-neutral shape; surfaced per-actor because off-chain delegation
// (space-scoped, one-to-many) doesn't fit the EVM-shaped /delegations list. `weight` null = full;
// `scope` null = global (all spaces).
export class OffchainDelegationDto {
  @ApiProperty()
  declare platform: string;

  @ApiProperty()
  declare system: string;

  @ApiPropertyOptional({ nullable: true })
  declare scope: string | null;

  @ApiProperty()
  declare network: string;

  @ApiProperty()
  declare delegate_address: string;

  @ApiPropertyOptional({ nullable: true })
  declare weight: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare expires_at: string | null;
}
