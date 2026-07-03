import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Snapshot proposal metadata DTO, discriminated by `kind` (== source_type). Contributed to the
// proposal-detail `metadata` union assembled by apps/api.
export class SnapshotProposalMetadataDto {
  @ApiProperty({ enum: ['snapshot'] })
  declare kind: 'snapshot';

  @ApiProperty()
  declare space_id: string;

  @ApiPropertyOptional({ nullable: true })
  declare voting_type: string | null;

  @ApiPropertyOptional({ nullable: true, type: Object })
  declare strategies: unknown | null;

  @ApiPropertyOptional({ nullable: true })
  declare ipfs_hash: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare network: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare scores_state: string | null;

  @ApiProperty()
  declare flagged: boolean;
}
